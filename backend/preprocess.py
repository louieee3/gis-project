import os
import json
import rasterio
from rasterio.mask import mask
from shapely.geometry import shape
from shapely.ops import transform as shapely_transform
from pyproj import Transformer

def preprocess_images():
    """
    Clips all source TIF images based on the parcels GeoJSON and saves them as new files.
    """
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DATA_DIR = os.path.join(BASE_DIR, "data")
    
    # 1. Load parcels geometry
    parcels_path = os.path.join(DATA_DIR, "test_4326.json")
    try:
        with open(parcels_path, "r", encoding="utf-8") as f:
            parcels_feature_collection = json.load(f)
        geoms = [shape(f["geometry"]) for f in parcels_feature_collection["features"]]
        print("✅ 地块 GeoJSON 数据加载成功!")
    except Exception as e:
        print(f"❌ 错误: 无法加载地块 GeoJSON 文件: {e}")
        return

    # 2. Loop through each year and process the corresponding TIF file
    imagery_dir = os.path.join(DATA_DIR, "武汉2018-2022遥感影像")
    years = [2018, 2019, 2020, 2021, 2022]

    for year in years:
        source_tif_path = os.path.join(imagery_dir, f"WH{year}_1.tif")
        clipped_tif_path = os.path.join(imagery_dir, f"WH{year}_1_clipped.tif")

        if not os.path.exists(source_tif_path):
            print(f"⚠️ 警告: 未找到源文件 {source_tif_path}，跳过...")
            continue
            
        print(f"⚙️ 正在处理 {source_tif_path}...")

        try:
            with rasterio.open(source_tif_path) as src:
                # --- 坐标系转换 ---
                # 假设地块数据是 WGS84 (EPSG:4326)，这是最常见的 GeoJSON 坐标系
                geojson_crs = "EPSG:4326"
                raster_crs = src.crs

                # 创建一个坐标转换器
                transformer = Transformer.from_crs(geojson_crs, raster_crs, always_xy=True)

                # 对每个地块几何图形进行坐标转换
                transformed_geoms = [shapely_transform(transformer.transform, g) for g in geoms]
                # --- 转换结束 ---

                # 使用转换后的几何图形进行裁剪
                out_image, out_transform = mask(src, transformed_geoms, crop=True)
                out_meta = src.meta.copy()

            # Update the metadata for the new, clipped raster
            out_meta.update({
                "driver": "GTiff",
                "height": out_image.shape[1],
                "width": out_image.shape[2],
                "transform": out_transform
            })

            # Write the clipped raster to a new file
            with rasterio.open(clipped_tif_path, "w", **out_meta) as dest:
                dest.write(out_image)
            
            print(f"✅ 成功创建裁剪后的文件: {clipped_tif_path}")

        except Exception as e:
            print(f"❌ 错误: 处理文件 {source_tif_path} 时失败: {e}")

if __name__ == "__main__":
    print("--- 开始预处理遥感影像 ---")
    preprocess_images()
    print("--- 所有处理完成 ---")
