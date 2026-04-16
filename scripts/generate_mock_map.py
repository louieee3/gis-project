import geopandas as gpd
from shapely.geometry import Polygon
import random
import os  # 引入 os 模块处理路径


def generate_grid(rows=10, cols=10, size=0.001):
    """生成一个简单的网格地图，模拟地块"""
    polygons = []
    ids = []

    # 起始经纬度 (模拟某城市坐标)
    start_lon = 114.30  # 武汉附近
    start_lat = 30.60

    for i in range(rows):
        for j in range(cols):
            # 生成 ID，例如 P_0_0, P_0_1
            parcel_id = f"P_{i}_{j}"

            # 计算四个顶点的坐标
            x = start_lon + j * size
            y = start_lat + i * size
            poly = Polygon([
                (x, y), (x + size, y), (x + size, y + size), (x, y + size)
            ])

            polygons.append(poly)
            ids.append(parcel_id)

    # 创建 GeoDataFrame
    gdf = gpd.GeoDataFrame({'parcel_id': ids, 'geometry': polygons})
    # 随机给一些基础属性
    gdf['area'] = [random.randint(500, 5000) for _ in range(len(gdf))]
    gdf['current_type'] = [random.choice(['荒地', '耕地', '林地']) for _ in range(len(gdf))]

    return gdf


if __name__ == "__main__":
    # --- 修复路径逻辑 ---
    # 1. 获取当前脚本所在的文件夹绝对路径 (即 D:\GIS_Project\scripts)
    CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

    # 2. 算出项目根目录 (即 D:\GIS_Project)
    PROJECT_ROOT = os.path.dirname(CURRENT_DIR)

    # 3. 拼接出数据文件夹的路径 (即 D:\GIS_Project\backend\data)
    DATA_DIR = os.path.join(PROJECT_ROOT, "backend", "data")

    # 4. 如果文件夹不存在，自动创建它 (防止报错)
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        print(f"📁 已自动创建文件夹: {DATA_DIR}")

    # 5. 生成文件路径
    output_path = os.path.join(DATA_DIR, "test_parcels.geojson")

    # --- 生成数据 ---
    gdf = generate_grid()

    # 保存为 GeoJSON
    try:
        gdf.to_file(output_path, driver="GeoJSON")
        print(f"✅ 成功！地图数据已生成: {output_path}")
    except Exception as e:
        print(f"❌ 生成失败: {e}")