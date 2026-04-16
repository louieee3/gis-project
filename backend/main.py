import asyncio
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import json
import os
import logging
import requests
import numpy as np
import pandas as pd
from functools import lru_cache
from starlette.responses import StreamingResponse
from rio_tiler.io import Reader
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.utils import render
from fastapi.responses import Response

class EvaluationModel:
    """轻量可解释评价模型：基于规则+加权的非农化风险评分"""

    # 各分项权重（总分上限100，波动项作为惩罚项）
    CURRENT_W   = 40.0
    PERSISTENCE_W = 20.0
    TREND_W     = 15.0
    RECENT_W    = 10.0
    FEATURE_W   = 15.0
    VOLATILITY_W = 10.0
    # 波动标准差归一化因子：std(levels)/1.5 后再截断到 [0, 1]
    VOLATILITY_NORM = 1.5
    # 将综合评分映射为离散风险等级（0-3）
    LEVEL_MAP   = lambda s: 0 if s < 30 else 1 if s < 50 else 2 if s < 70 else 3

    @staticmethod
    def _clip01(value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    @classmethod
    # 评价模型：输出综合评分、评分映射等级和分项拆解
    def evaluate(cls, level: int, yearly_levels: dict,
                 top5: list, top10: list) -> dict:
        levels = [yearly_levels[2019], yearly_levels[2020],
                  yearly_levels[2021], yearly_levels[2022]]

        # 当前风险：以最新等级(2022)为主，归一化到 [0,1]
        current_norm = cls._clip01(level / 3.0)
        # 风险持续性：近4年平均等级，体现“持续偏高”的程度
        persistence_norm = cls._clip01(float(np.mean(levels)) / 3.0)
        # 长期趋势：2022 相对 2019 的净变化，仅奖励上升（下降截断为0）
        trend_norm = cls._clip01((yearly_levels[2022] - yearly_levels[2019]) / 3.0)
        # 近期变化：2022 相对 2021 的变化，反映短期抬升
        recent_norm = cls._clip01((yearly_levels[2022] - yearly_levels[2021]) / 3.0)
        # 特征强度：Top5 特征贡献均值，衡量关键驱动因子强弱
        fv = float(np.mean([v for _, v in top5])) if top5 else 0.0
        feature_norm = cls._clip01(fv)
        # 波动惩罚：历史等级波动越大，惩罚越重
        vol    = float(np.std(levels))
        volatility_norm = cls._clip01(vol / cls.VOLATILITY_NORM)

        current_score = cls.CURRENT_W * current_norm
        persistence_score = cls.PERSISTENCE_W * persistence_norm
        trend_score = cls.TREND_W * trend_norm
        recent_score = cls.RECENT_W * recent_norm
        feature_score = cls.FEATURE_W * feature_norm
        # 惩罚项为负分
        penalty = -cls.VOLATILITY_W * volatility_norm

        # 总分截断到 [0,100]，再映射风险等级
        score  = max(0.0, min(100.0, current_score + persistence_score + trend_score + recent_score + feature_score + penalty))
        new_lv = cls.LEVEL_MAP(score)

        return {
            "score": round(score, 1),
            "level": new_lv,
            "components": {
                "current": round(current_score, 2),
                "persistence": round(persistence_score, 2),
                "trend": round(trend_score, 2),
                "recent": round(recent_score, 2),
                "feature": round(feature_score, 2),
                "penalty": round(penalty, 2)
            },
            "top_features_top5": [{"name": k, "value": round(float(v), 6)} for k, v in top5],
            "top_features_top10": [{"name": k, "value": round(float(v), 6)} for k, v in top10],
            "raw_levels": levels
        }


def _eval_on_features(level: int, yearly_levels: dict,
                       features_2023: dict) -> dict:
    sorted_items = sorted(features_2023.items(), key=lambda x: x[1], reverse=True)
    top5  = sorted_items[:5]
    top10 = sorted_items[:10]
    return EvaluationModel.evaluate(level, yearly_levels, top5, top10)


# --- 1. 初始化 FastAPI 实例 (必须放在最前面) ---
app = FastAPI()

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"], # 明确允许前端的源
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"], # 明确允许所有需要的方法
    allow_headers=["Content-Type", "Authorization"], # 明确允许所有需要的头部
)

# --- 1.5. 配置日志记录 ---
# 所有错误都将被记录到 backend_errors.log 文件中
logging.basicConfig(
    filename="backend_errors.log",
    level=logging.ERROR,
    format='%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s'
)

# --- 2. 配置 AI API ---
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "YOUR_API_KEY")
CHAT_API_URL = "https://api.deepseek.com/chat/completions"
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "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").strip()
TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# 获取路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
IMAGERY_DIR = os.path.join(DATA_DIR, "武汉2018-2022遥感影像")
PREDICTION_XLSX_PATH = os.path.join(DATA_DIR, "预测结果.xlsx")
FEATURE_IMPORTANCE_DIR = os.path.join(DATA_DIR, "特征重要性")

# 加载规则库
rules_path = os.path.join(DATA_DIR, "mock_rules.json")
try:
    with open(rules_path, "r", encoding="utf-8") as f:
        RULES_DB = json.load(f)
except FileNotFoundError:
    RULES_DB = []


def tavily_search(query: str, max_results: int = 5) -> list:
    """调用 Tavily 检索，返回精简后的结果列表。"""
    if not TAVILY_API_KEY or not query:
        return []

    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "advanced",
        "include_answer": False,
        "include_raw_content": False,
        "max_results": max(1, min(int(max_results), 8))
    }
    try:
        resp = requests.post(TAVILY_SEARCH_URL, json=payload, timeout=18)
        resp.raise_for_status()
        data = resp.json()
        rows = data.get("results", []) or []
        cleaned = []
        for item in rows:
            title = str(item.get("title", "")).strip()
            url = str(item.get("url", "")).strip()
            content = str(item.get("content", "")).strip()
            if not (title or url or content):
                continue
            cleaned.append({
                "title": title,
                "url": url,
                "content": content[:500]
            })
        return cleaned
    except Exception:
        logging.error("Tavily search failed", exc_info=True)
        return []


def load_real_predictions() -> dict:
    if not os.path.exists(PREDICTION_XLSX_PATH):
        logging.error(f"Prediction file not found: {PREDICTION_XLSX_PATH}")
        return {}

    try:
        df = pd.read_excel(PREDICTION_XLSX_PATH, sheet_name=0)
    except Exception:
        logging.error("Failed to read prediction excel", exc_info=True)
        return {}

    required_columns = {"OBJECTID", "pred19", "pred20", "pred21", "pred22"}
    missing_columns = required_columns - set(df.columns)
    if missing_columns:
        logging.error(f"Prediction file missing required columns: {sorted(missing_columns)}")
        return {}

    predictions = {}
    for _, row in df.iterrows():
        object_id = row.get("OBJECTID")
        if pd.isna(object_id):
            continue

        object_id = int(object_id)
        yearly_levels = {}
        for year in (2019, 2020, 2021, 2022):
            value = row.get(f"pred{str(year)[-2:]}")
            if pd.isna(value):
                value = 0
            value = int(value)
            value = max(0, min(3, value))
            yearly_levels[year] = value

        predictions[object_id] = {
            "object_id": object_id,
            "name": str(row.get("name", "")) if not pd.isna(row.get("name")) else "",
            "gb": int(row.get("gb")) if not pd.isna(row.get("gb")) else None,
            "yearly_levels": yearly_levels
        }
    return predictions


REAL_PREDICTIONS = load_real_predictions()


FEATURE_IMPORTANCE_YEAR_FILES = {
    2020: ("18_19.xlsx", 2019),
    2021: ("19_20.xlsx", 2020),
    2022: ("20_21.xlsx", 2021),
    2023: ("21_22.xlsx", 2022)
}

LEVEL_TO_CLASS_LABEL = {
    0: "None",
    1: "Low",
    2: "Mid",
    3: "High"
}
SIGNIFICANT_FEATURE_COUNT = 10


def normalize_column_name(name: str) -> str:
    return str(name).replace(" ", "").replace("　", "")


def format_feature_label(dim: str, name: str) -> str:
    text = str(name)
    if "ndvi冬" in text:
        text = text.replace("ndvi冬", "冬季NDVI")
    if "ndvi秋" in text:
        text = text.replace("ndvi秋", "秋季NDVI")
    if "ndvi夏" in text:
        text = text.replace("ndvi夏", "夏季NDVI")
    if "ndvi春" in text:
        text = text.replace("ndvi春", "春季NDVI")
    return f"{dim}-{text}"


def load_feature_importance_data() -> dict:
    result = {}
    for year, (filename, _) in FEATURE_IMPORTANCE_YEAR_FILES.items():
        file_path = os.path.join(FEATURE_IMPORTANCE_DIR, filename)
        if not os.path.exists(file_path):
            logging.error(f"Feature importance file not found: {file_path}")
            continue
        try:
            df = pd.read_excel(file_path, sheet_name=0)
        except Exception:
            logging.error(f"Failed to read feature importance file: {file_path}", exc_info=True)
            continue

        rename_map = {col: normalize_column_name(col) for col in df.columns}
        df = df.rename(columns=rename_map)
        required_columns = {"特征维度", "None", "Low", "Mid", "High"}
        missing = required_columns - set(df.columns)
        if missing:
            logging.error(f"Feature importance file missing columns: {sorted(missing)} in {file_path}")
            continue

        feature_labels = []
        feature_names = {}
        class_values = {
            "None": {},
            "Low": {},
            "Mid": {},
            "High": {}
        }
        for _, row in df.iterrows():
            dim = row.get("特征维度")
            if pd.isna(dim):
                continue
            feature_key = str(int(dim)) if not pd.isna(dim) else str(len(feature_labels) + 1)
            feature_labels.append(feature_key)
            feature_name = row.get("特征名称")
            if pd.isna(feature_name):
                feature_name = feature_key
            feature_names[feature_key] = str(feature_name)
            for class_label in ("None", "Low", "Mid", "High"):
                value = row.get(class_label)
                if pd.isna(value):
                    value = 0.0
                class_values[class_label][feature_key] = round(float(value), 6)

        result[year] = {
            "features": feature_labels,
            "feature_names": feature_names,
            "class_values": class_values
        }
    return result


FEATURE_IMPORTANCE_DATA = load_feature_importance_data()


@lru_cache(maxsize=5)
def resolve_tif_path(year: int) -> str:
    tif_path = os.path.join(IMAGERY_DIR, f"WH{year}_1.tif")
    if not os.path.exists(tif_path):
        raise FileNotFoundError(f"TIF file not found for year {year}: {tif_path}")
    return tif_path


@lru_cache(maxsize=5)
def get_year_rescale_params(year: int) -> tuple:
    tif_path = resolve_tif_path(year)
    with Reader(tif_path) as src:
        preview = src.preview(indexes=(1, 2, 3), max_size=1024)

    valid_mask = preview.mask > 0
    band_params = []
    for band in preview.data.astype(np.float32):
        valid_values = band[valid_mask]
        if valid_values.size == 0:
            band_params.append((0.0, 1.0))
            continue
        min_val, max_val = np.percentile(valid_values, [2, 98])
        if max_val <= min_val:
            max_val = min_val + 1.0
        band_params.append((float(min_val), float(max_val)))
    return tuple(band_params)


@lru_cache(maxsize=5)
def get_year_rescale_arrays(year: int) -> tuple:
    band_params = get_year_rescale_params(year)
    min_vals = np.array([p[0] for p in band_params], dtype=np.float32).reshape(3, 1, 1)
    max_vals = np.array([p[1] for p in band_params], dtype=np.float32).reshape(3, 1, 1)
    denominator = np.maximum(max_vals - min_vals, 1.0)
    return min_vals, denominator


def normalize_tile_data(data: np.ndarray, year: int) -> np.ndarray:
    min_vals, denominator = get_year_rescale_arrays(year)
    normalized = (data.astype(np.float32) - min_vals) / denominator
    return np.clip(normalized, 0.0, 1.0)


@lru_cache(maxsize=20000)
def generate_tile_content(year: int, z: int, x: int, y: int) -> bytes:
    tif_path = resolve_tif_path(year)
    with Reader(tif_path) as src:
        img = src.tile(x, y, z, indexes=(1, 2, 3))

    scaled = normalize_tile_data(img.data, year) * 255.0
    rescaled_data = np.clip(scaled, 0, 255).astype(np.uint8)
    non_black_mask = np.any(img.data > 0, axis=0)
    combined_mask = np.where((img.mask > 0) & non_black_mask, 255, 0).astype(np.uint8)
    return render(rescaled_data, mask=combined_mask, img_format="PNG")


@lru_cache(maxsize=40000)
def generate_change_tile_content(base_year: int, current_year: int, z: int, x: int, y: int) -> bytes:
    base_tif_path = resolve_tif_path(base_year)
    current_tif_path = resolve_tif_path(current_year)

    with Reader(base_tif_path) as src:
        base_img = src.tile(x, y, z, indexes=(1, 2, 3))
    with Reader(current_tif_path) as src:
        current_img = src.tile(x, y, z, indexes=(1, 2, 3))

    valid = (base_img.mask > 0) & (current_img.mask > 0)
    if not np.any(valid):
        empty = np.zeros((3, 256, 256), dtype=np.uint8)
        empty_mask = np.zeros((256, 256), dtype=np.uint8)
        return render(empty, mask=empty_mask, img_format="PNG")

    base_norm = normalize_tile_data(base_img.data, base_year)
    current_norm = normalize_tile_data(current_img.data, current_year)

    base_non_farm = (base_norm[1] + base_norm[2]) - base_norm[0]
    current_non_farm = (current_norm[1] + current_norm[2]) - current_norm[0]
    delta = np.where(valid, current_non_farm - base_non_farm, 0.0)

    threshold = 0.08
    intensity = np.clip((delta - threshold) / 0.30, 0.0, 1.0)
    change_mask = np.where(intensity > 0, 255, 0).astype(np.uint8)

    red = (255.0 * intensity).astype(np.uint8)
    green = (90.0 * intensity).astype(np.uint8)
    blue = np.zeros_like(red, dtype=np.uint8)
    change_rgb = np.stack([red, green, blue], axis=0)
    return render(change_rgb, mask=change_mask, img_format="PNG")

# --- 3. 路由定义 ---

@app.get("/")
def read_root():
    return {"status": "online"}


@app.get("/api/parcels")
def get_parcels():
    parcels_path = os.path.join(DATA_DIR, "test_4326.json")
    try:
        with open(parcels_path, "r", encoding="utf-8") as f:
            geojson = json.load(f)

        for feature in geojson.get("features", []):
            properties = feature.setdefault("properties", {})
            object_id = properties.get("OBJECTID")
            try:
                object_id = int(float(object_id))
            except (TypeError, ValueError):
                properties["risk_level"] = 0
                properties["risk_label"] = "低风险"
                properties["risk_confidence"] = 0.0
                continue

            row = REAL_PREDICTIONS.get(object_id)
            if not row:
                properties["risk_level"] = 0
                properties["risk_label"] = "低风险"
                properties["risk_confidence"] = 0.0
                continue

            yearly_levels = row.get("yearly_levels", {})
            level = int(yearly_levels.get(2022, 0))
            properties["risk_level"] = level
            properties["risk_label"] = LEVEL_TO_CLASS_LABEL.get(level, "None")
            properties["risk_confidence"] = round(0.65 + 0.1 * (level / 3.0), 3)

        return geojson
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Parcels file not found.")
    except Exception as e:
        logging.error("Load parcels failed", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load parcels.")



# 获取地块预测详情
@app.get("/api/predict/{parcel_id}")
def predict_parcel(parcel_id: str):
    try:
        object_id = int(float(parcel_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid parcel id.")

    row = REAL_PREDICTIONS.get(object_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Prediction for parcel {parcel_id} not found.")

    yearly_levels = row["yearly_levels"]
    levels = [yearly_levels[2019], yearly_levels[2020], yearly_levels[2021], yearly_levels[2022]]
    level = yearly_levels[2022]

    probs = [0.0, 0.0, 0.0, 0.0]
    probs[level] = 1.0

    volatility = float(np.std(levels) / 1.5)
    volatility = min(1.0, max(0.0, volatility))
    trend = float((yearly_levels[2022] - yearly_levels[2019] + 3) / 6)
    intensity = float(np.mean(levels) / 3.0)
    recent_change = float((yearly_levels[2022] - yearly_levels[2021] + 3) / 6)
    high_risk_ratio = float(sum(1 for v in levels if v >= 2) / 4.0)
    confidence = min(0.99, max(0.55, 0.65 + 0.1 * (level / 3.0) + 0.25 * (1.0 - volatility)))

    features = {
        "历史风险强度": round(intensity, 3),
        "风险上升趋势": round(trend, 3),
        "近年变化速率": round(recent_change, 3),
        "高风险占比": round(high_risk_ratio, 3),
        "时序稳定性": round(1.0 - volatility, 3)
    }

    return {
        "parcel_id": str(object_id),
        "prediction": {"level": level, "probabilities": probs, "confidence": confidence},
        "explainability": {"features": features},
        "real_data": {
            "name": row["name"],
            "gb": row["gb"],
            "yearly_levels": yearly_levels
        }
    }


@app.get("/api/predict_history/{parcel_id}")
def predict_history(parcel_id: str, top_k: int = Query(SIGNIFICANT_FEATURE_COUNT, ge=1, le=69)):
    try:
        object_id = int(float(parcel_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid parcel id.")

    prediction_row = REAL_PREDICTIONS.get(object_id)
    if not prediction_row:
        raise HTTPException(status_code=404, detail=f"Prediction for parcel {parcel_id} not found.")

    yearly_levels = prediction_row["yearly_levels"]
    yearly_features = {}
    yearly_classes = {}
    feature_name_map = {}
    for display_year, (_, class_year) in FEATURE_IMPORTANCE_YEAR_FILES.items():
        year_importance = FEATURE_IMPORTANCE_DATA.get(display_year)
        if not year_importance:
            continue
        level = yearly_levels.get(class_year, 0)
        class_label = LEVEL_TO_CLASS_LABEL.get(level, "None")
        class_features = year_importance["class_values"].get(class_label, {})
        if len(class_features) == 0:
            continue
        yearly_features[str(display_year)] = class_features
        yearly_classes[str(display_year)] = class_label
        feature_name_map.update(year_importance.get("feature_names", {}))

    if len(yearly_features) == 0:
        raise HTTPException(status_code=404, detail=f"No history features found for parcel {parcel_id}.")

    aggregate_importance = {}
    for features in yearly_features.values():
        for dim, value in features.items():
            aggregate_importance[dim] = aggregate_importance.get(dim, 0.0) + float(value)

    allowed_top_k = {5, 10}
    top_k_used = top_k if top_k in allowed_top_k else SIGNIFICANT_FEATURE_COUNT

    top_feature_dims = [
        dim for dim, _ in sorted(
            aggregate_importance.items(),
            key=lambda item: item[1],
            reverse=True
        )[:top_k_used]
    ]

    compact_yearly_features = {}
    feature_catalog = []
    for year, features in yearly_features.items():
        compact_features = {}
        for dim in top_feature_dims:
            feature_name = feature_name_map.get(dim, dim)
            feature_label = format_feature_label(dim, feature_name)
            compact_features[feature_label] = round(float(features.get(dim, 0.0)), 6)
        compact_yearly_features[year] = compact_features

    for dim in top_feature_dims:
        feature_name = feature_name_map.get(dim, dim)
        feature_label = format_feature_label(dim, feature_name)
        feature_catalog.append({
            "label": feature_label,
            "dimension": dim,
            "name": feature_name
        })

    return {
        "parcel_id": str(object_id),
        "yearly_features": compact_yearly_features,
        "yearly_classes": yearly_classes,
        "feature_catalog": feature_catalog,
        "top_k_used": top_k_used
    }


# 动态瓦片服务
@app.get("/api/tiles/{year}/{z}/{x}/{y}", response_class=Response)
def get_tile(year: int, z: int, x: int, y: int):
    if not 2018 <= year <= 2022:
        raise HTTPException(status_code=404, detail="Invalid year specified.")

    try:
        content = generate_tile_content(year, z, x, y)
        return Response(
            content=content,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=31536000, immutable"}
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Image for year {year} not found.")
    except Exception as e:
        logging.error(f"Tile generation failed for {z}/{x}/{y}", exc_info=True)
        if isinstance(e, TileOutsideBounds):
            return Response(content=b'', status_code=204)
        raise HTTPException(status_code=500, detail="Tile generation failed.")


@app.get("/api/change_tiles/{base_year}/{current_year}/{z}/{x}/{y}", response_class=Response)
def get_change_tile(base_year: int, current_year: int, z: int, x: int, y: int):
    if not 2018 <= base_year <= 2022 or not 2018 <= current_year <= 2022:
        raise HTTPException(status_code=404, detail="Invalid year specified.")

    if current_year == base_year:
        return Response(content=b'', status_code=204)

    try:
        content = generate_change_tile_content(base_year, current_year, z, x, y)
        return Response(
            content=content,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=31536000, immutable"}
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found.")
    except Exception as e:
        logging.error(f"Change tile generation failed for {z}/{x}/{y}", exc_info=True)
        if isinstance(e, TileOutsideBounds):
            return Response(content=b'', status_code=204)
        raise HTTPException(status_code=500, detail="Change tile generation failed.")

@app.get("/api/forecast/{parcel_id}")
def forecast_stub(parcel_id: str):
    try:
        object_id = int(float(parcel_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid parcel id.")
    return {
        "parcel_id": str(object_id),
        "model": "TBD",
        "status": "stub",
        "message": "预测功能为占位，将在接入训练模型后返回未来1-3年等级与置信度。",
        "inputs": ["Top特征时序", "宏观变量", "规划管控"],
        "outputs": ["未来年度风险等级", "区间置信度"]
    }

# AI 聊天接口（中转站流式）
async def relay_and_type_response(data: dict):
    user_message = data.get("message")
    context = data.get("context")
    clean_api_key = API_KEY.strip()

    def _chunk_text(text: str, size: int = 24):
        for i in range(0, len(text), size):
            yield text[i:i + size]

    def _safe_get_parcel_id(ctx) -> int:
        try:
            pid = ctx.get("parcel_id") or ctx.get("OBJECTID") or ctx.get("id")
            return int(float(pid))
        except Exception:
            return None

    def _build_evaluation_parts(pid: int) -> tuple:
        """返回 (thinking_text, eval_payload, conclusion_text) 三部分"""
        try:
            current = predict_parcel(str(pid))
            history = predict_history(str(pid), top_k=10)
            level = current["prediction"]["level"]
            confidence = current["prediction"]["confidence"]
            yearly_levels = current["real_data"]["yearly_levels"]
            features_2023 = history["yearly_features"].get("2023", {})

            result = _eval_on_features(level, yearly_levels, features_2023)

            eval_payload = {
                "type": "evaluation",
                "model": "EvaluationModel-v2",
                "parcel_id": pid,
                "score": result["score"],
                "level": level,
                "predicted_level": level,
                "score_level": result["level"],
                "confidence": float(confidence),
                "classes": {
                    "2020": history["yearly_classes"].get("2020", "None"),
                    "2023": history["yearly_classes"].get("2023", "None")
                },
                "components": result["components"],
                "top_features_top5": result["top_features_top5"],
                "top_features_top10": result["top_features_top10"],
                "summary": "非农化综合评价已完成"
            }

            top_lines = "\n".join([
                f"- {f['name']}: {round(float(f['value']), 4)}"
                for f in result["top_features_top5"]
            ])
            c = result["components"]
            
            thinking_text = (
                f"<thinking>启动 EvaluationModel-v2，对地块 {pid} 执行非农化综合评价\n"
                f"\n"
                f"Step 1 — 当前状态量化\n"
                f"  输入风险等级 = {level}，映射基础分 = {c['current']}\n"
                f"\n"
                f"Step 2 — 时序持续性分析\n"
                f"  多年级别序列：{yearly_levels}\n"
                f"  持续性分 = {c['persistence']}（连续高风险帧累计加权）\n"
                f"\n"
                f"Step 3 — 趋势与波动推导\n"
                f"  长期趋势分 = {c['trend']}（线性回归斜率归一化）\n"
                f"  近期变化分 = {c['recent']}（近2年变化幅度加权）\n"
                f"  波动惩罚   = -{c['penalty']}（std / {c.get('volatility_norm', 1.5)} 截断映射）\n"
                f"\n"
                f"Step 4 — 遥感特征强度计算\n"
                f"  2023年 Top5 特征均值归一化 → 特征强度分 = {c['feature']}\n"
                f"\n"
                f"Step 5 — 综合评分汇总\n"
                f"  Score = {c['current']} + {c['persistence']} + {c['trend']} + {c['recent']} + {c['feature']} - {c['penalty']}\n"
                f"        = {result['score']} / 100  →  评分等级 {result['level']}\n"
                f"</thinking>"
            )
            
            conclusion_text = (
                f"当前结论：\n"
                f"- 评价模型：EvaluationModel-v2\n"
                f"- 预测风险等级：{level}\n"
                f"- 综合评分：{result['score']} / 100（评分映射等级 {result['level']}）\n"
                f"- 置信度：{round(confidence*100, 1)}%\n"
                f"- 历史类别：2020={eval_payload['classes']['2020']}，"
                f"2023={eval_payload['classes']['2023']}\n"
                f"- 2023年 Top5 特征：\n{top_lines}\n"
                f"建议：\n"
                f"1) 结合年度差值图，关注 Top5 中变化幅度较大的维度\n"
                f"2) 若需降级风险，优先在排名前2的特征上采取针对性干预\n"
            )
            return thinking_text, eval_payload, conclusion_text
        except Exception as e:
            return f"<thinking>本地评价流程失败</thinking>", {}, f"错误详情: {str(e)}"

    def _build_forecast_text(pid: int) -> str:
        payload = {
            "type": "forecast",
            "parcel_id": pid,
            "status": "stub",
            "summary": "未来非农化预测为占位，模型接入后返回真实结果"
        }
        return (
            f"<thinking>创建未来非农化预测占位</thinking>"
            f"<ui_forecast>{json.dumps(payload, ensure_ascii=False)}</ui_forecast>"
            f"预测占位：\n"
            f"- 地块ID：{pid}\n"
            f"- 模型：待接入（支持时序回归/树模型/时空图模型）\n"
            f"- 输入：Top特征时序、外部宏观变量、规划约束\n"
            f"- 输出：未来1-3年风险等级与区间置信度\n"
        )

    # 0. 关键词触发（优先本地直出，保证演示稳定）
    pid = _safe_get_parcel_id(context or {})
    lm = (user_message or "").lower()
    if pid and ("非农化评价" in user_message or ("评价" in user_message and "非农" in user_message)):
        thinking_text, eval_payload, conclusion_text = _build_evaluation_parts(pid)
        
        # 1. 分小块流式发送思考过程（5字符/块, 40ms/块，克服TCP缓冲）
        for i in range(0, len(thinking_text), 5):
            yield thinking_text[i:i+5]
            await asyncio.sleep(0.04)
        
        # 2. 思考过程输出完毕后短暂停顿，再弹出评价结果（总时间≈3秒）
        await asyncio.sleep(1.0)
        
        # 3. 一次性发送评价弹窗数据（前端解析后立即弹窗）
        ui_eval_content = f"<ui_eval>{json.dumps(eval_payload, ensure_ascii=False)}</ui_eval>"
        yield ui_eval_content
        
        # 4. 结论文本分小块流式输出
        for i in range(0, len(conclusion_text), 5):
            yield conclusion_text[i:i+5]
            await asyncio.sleep(0.04)
        return
    # 未来预测触发暂不启用（保留占位接口，但不在对话中触发UI）

    # ── 意图识别：判断是否需要联网搜索 ──────────────────────────────
    # 用一次轻量 LLM 调用做意图分类，而非关键词匹配
    # 需要联网的意图：外部事件/政策/新闻/规划/开发动态等现实背景信息
    # 不需要联网：纯地块数据分析、风险解读、特征推理等
    async def _need_web_search(question: str) -> bool:
        if not TAVILY_API_KEY:
            return False
        classify_prompt = (
            "判断以下问题是否需要联网搜索外部信息才能回答。\n"
            "需要联网的情形：询问现实事件、政府政策、新闻、区域开发规划、拆迁征地动态、"
            "历史上发生了什么、为什么发生变化（需外部背景解释）等。\n"
            "不需要联网的情形：分析地块风险数据、解读特征重要性、趋势推断、模型评分等。\n\n"
            f"问题：{question}\n\n"
            "只回答 YES 或 NO，不要其他内容。"
        )
        try:
            def _classify():
                resp = requests.post(
                    CHAT_API_URL,
                    json={
                        "model": "deepseek-chat",
                        "messages": [{"role": "user", "content": classify_prompt}],
                        "max_tokens": 4,
                        "temperature": 0,
                    },
                    headers={"Authorization": f"Bearer {clean_api_key}", "Content-Type": "application/json"},
                    timeout=8,
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"].strip().upper()
            result = await asyncio.to_thread(_classify)
            return result.startswith("Y")
        except Exception:
            return False

    # 1. 获取完整AI响应
    use_web_search = await _need_web_search(user_message)
    if use_web_search:
        # 自动在搜索词中附加地块所在区域，提升地域相关性
        district = (context or {}).get("district") or (context or {}).get("区域") or ""
        search_query = f"{district} {user_message}".strip() if district else user_message
        web_results = tavily_search(search_query, max_results=5)
    else:
        web_results = []
    web_block = ""
    if web_results:
        web_lines = []
        for i, row in enumerate(web_results, start=1):
            web_lines.append(
                f"{i}. 标题: {row.get('title', '')}\n"
                f"   链接: {row.get('url', '')}\n"
                f"   摘要: {row.get('content', '')}"
            )
        web_block = "\n\n**联网检索结果**:\n" + "\n".join(web_lines)

    prompt = f"""你是"农地卫士"非农化风险分析引擎的核心推理模块。当前地块的遥感特征向量和历史风险序列已加载到你的推理上下文中，你正在对用户的问题执行实时推断。

## 身份设定
你 **就是** 这个推理引擎本身，地块数据是你的内部状态，不是外部输入。你"知道"这些数值，而不是"看到"或"读取"它们。

## 表达规范（必须严格遵守）
【禁止使用的表达】
- ❌ 输入数据中包含… / 数据显示… / 根据提供的数据… / 从JSON中…
- ❌ 查询 / 检索 / 读取 / 获取 / 提取 / 根据您提供…
- ❌ 逐条罗列字段（如"字段A为X，字段B为Y，字段C为Z…"）

【应当使用的表达】
- ✅ 当前风险序列为… / 特征向量显示… / 推理得… / 计算得… / 判断为…
- ✅ 直接说结论，用数值支撑，不复述字段名
- ✅ 思考过程体现：问题拆解 → 关键指标定位 → 模型推断 → 结论

## 思考长度要求
thinking 部分控制在 150 字以内，简洁推导，不展开罗列每个字段。

## few-shot 示例（thinking 的正确写法）
问题：该地块近年风险为何波动剧烈？
<thinking>
风险序列 2→3→0→3，振幅跨越全等级范围。变化速率达峰值，判断为受外部扰动驱动的间歇性高强度活动，而非持续建设。稳定性极低，推断为周期性用途切换。
</thinking>

问题：当地有什么政策影响了非农化？（含联网结果）
<thinking>
定位问题：需要结合外部事件解释风险序列中 2020、2022 两次峰值。联网结果显示江夏区 2020 年启动某开发区扩建，与峰值吻合。推断：政策驱动建设活动 → 等级跳升至 3。
</thinking>

## 响应格式
<thinking>
[简洁推导过程，150字以内]
</thinking>
[直接给用户的专业结论，2-4句]

---
地块内部状态:
```json
{json.dumps(context, ensure_ascii=False, indent=2)}
```
{web_block}

问题: {user_message}"""

    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": prompt}],
        # 注意：移除了 "stream": True
    }
    headers = {
        "Authorization": f"Bearer {clean_api_key}",
        "Content-Type": "application/json"
    }

    full_response_text = ""
    try:
        # 用 asyncio.to_thread 避免阻塞事件循环
        def _call_api():
            resp = requests.post(CHAT_API_URL, data=json.dumps(payload), headers=headers, timeout=60)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        full_response_text = await asyncio.to_thread(_call_api)
    except Exception as e:
        full_response_text = f"<thinking>AI服务连接失败</thinking>错误详情: {str(e)}"

    # 2. 分块流式传输完整响应
    for i in range(0, len(full_response_text), 5):
        yield full_response_text[i:i+5]
        await asyncio.sleep(0.04)

@app.post("/api/chat")
async def chat_with_ai(data: dict):
    if not data.get("context"):
        raise HTTPException(status_code=400, detail="请先在地图上选中一个地块。")
    return StreamingResponse(
        relay_and_type_response(data),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
