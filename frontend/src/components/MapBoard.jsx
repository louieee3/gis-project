import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';
import useStore from '../store/useStore';
import TimelineSlider from './TimelineSlider';
import OverlayCard from './OverlayCard';

import bbox from '@turf/bbox';

const TILE_VERSION = '20260329a';

const FALLBACK_STYLE = {
  version: 8,
  name: 'OSM Fallback Style',
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [
    {
      id: 'osm-raster',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

const resolveMapStyle = () => {
  const envStyle = import.meta.env.VITE_MAP_STYLE_URL;
  if (typeof envStyle === 'string' && envStyle.trim()) {
    return envStyle.trim();
  }
  return FALLBACK_STYLE;
};

const MapBoard = () => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const highlightPulseRef = useRef(null);
  const setSelectedParcel = useStore((state) => state.setSelectedParcel);
  const overlay = useStore((state) => state.overlay);
  const overlayPos = useStore((state) => state.overlayPos);
  const setOverlayPos = useStore((state) => state.setOverlayPos);
  const closeOverlay = useStore((state) => state.closeOverlay);
  const updateOverlayData = useStore((state) => state.updateOverlayData);
  const viewMode = useStore((state) => state.viewMode);
  const setClickPoint = useStore((state) => state.setClickPoint);

  // 时间和播放状态
  const [currentYear, setCurrentYear] = useState(2018);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMapLoaded, setIsMapLoaded] = useState(false); // 新增：追踪地图加载状态
  const intervalRef = useRef(null);
  const initialBoundsRef = useRef(null);

  useEffect(() => {
    if (map.current) return;

    console.log("🗺️ 初始化地图...");
    // src/components/MapBoard.jsx

map.current = new maplibregl.Map({
      container: mapContainer.current,
  style: resolveMapStyle(),
      center: [113.84, 30.18],
      zoom: 12,
      fadeDuration: 0
    });

    // 添加比例尺控件
    map.current.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.current.on('load', async () => {
      console.log("✅ 地图资源加载完毕");

      // --- 1. 首先加载并绘制地块数据 ---
      try {
        console.log("📡 请求 GeoJSON 数据...");
        const response = await axios.get('/api/parcels');
        const geojsonData = response.data;
        console.log("📦 数据接收成功，地块数量:", geojsonData.features.length);

        // --- 计算地块边界，初始定位到数据范围（不限制拖拽） ---
        const bounds = bbox(geojsonData);
        initialBoundsRef.current = bounds;
        map.current.fitBounds(bounds, {
          padding: 20,
          duration: 0
        });
        const rasterBounds = [bounds[0], bounds[1], bounds[2], bounds[3]];
        // --- 结束新增 ---

        if (!map.current) return;

        if (!map.current.getSource('parcels')) {
            map.current.addSource('parcels', {
                type: 'geojson',
                data: geojsonData
            });
        }

        if (!map.current.getLayer('parcels-fill')) {
            map.current.addLayer({
                'id': 'parcels-fill',
                'type': 'fill',
                'source': 'parcels',
                'paint': {
              'fill-color': [
                'match',
                ['coalesce', ['get', 'risk_level'], 0],
                0, '#4ade80',
                1, '#facc15',
                2, '#fb923c',
                3, '#ef4444',
                '#94a3b8'
              ],
              'fill-opacity': [
                'match',
                ['coalesce', ['get', 'risk_level'], 0],
                0, 0.28,
                1, 0.36,
                2, 0.46,
                3, 0.58,
                0.3
              ],
              'fill-outline-color': 'rgba(0,0,0,0)'
                }
            });
        }

              if (!map.current.getLayer('parcels-boundary-casing')) {
                map.current.addLayer({
                  'id': 'parcels-boundary-casing',
                  'type': 'line',
                  'source': 'parcels',
                  'paint': {
                    'line-color': '#fff7d6',
                    'line-width': 3.6,
                    'line-opacity': 0.95
                  }
                });
              }

              if (!map.current.getLayer('parcels-boundary')) {
                map.current.addLayer({
                  'id': 'parcels-boundary',
                  'type': 'line',
                  'source': 'parcels',
                  'paint': {
                    'line-color': '#ff9f1c',
                    'line-width': 2.2,
                    'line-opacity': 1
                  }
                });
              }

        if (!map.current.getLayer('parcels-highlight')) {
            map.current.addLayer({
                'id': 'parcels-highlight',
                'type': 'line',
                'source': 'parcels',
                'paint': {
                    'line-color': '#ff0000',
                    'line-width': 4
                },
                'filter': ['==', 'parcel_id', '']
            });
        }

        console.log("🎨 地块图层绘制完成");

        // --- 2. 然后，在下方添加遥感影像图层 (新) ---
        const years = [2018, 2019, 2020, 2021, 2022];
        for (const year of years) {
            if (map.current.getSource(`raster-tiles-${year}`)) continue;

            map.current.addSource(`raster-tiles-${year}`, {
                type: 'raster',
                tiles: [`/api/tiles/${year}/{z}/{x}/{y}?v=${TILE_VERSION}`],
                tileSize: 256,
                minzoom: 8,
                maxzoom: 18,
                bounds: rasterBounds
            });
            map.current.addLayer({
                id: `raster-layer-${year}`,
                type: 'raster',
                source: `raster-tiles-${year}`,
                paint: {
                    'raster-opacity': 1,
                    'raster-fade-duration': 0,
                    'raster-resampling': 'nearest'
                },
                layout: {
                    visibility: 'none'
                }
            }, 'parcels-fill');

            map.current.addSource(`change-tiles-${year}`, {
                type: 'raster',
                tiles: [`/api/change_tiles/2018/${year}/{z}/{x}/{y}?v=${TILE_VERSION}`],
                tileSize: 256,
                minzoom: 8,
                maxzoom: 18,
                bounds: rasterBounds
            });
            map.current.addLayer({
                id: `change-layer-${year}`,
                type: 'raster',
                source: `change-tiles-${year}`,
                paint: {
                    'raster-opacity': 0.9,
                    'raster-fade-duration': 0,
                    'raster-resampling': 'nearest'
                },
                layout: {
                    visibility: 'none'
                }
            }, 'parcels-fill');
        }
        console.log("🛰️ 遥感影像图层已添加");

        // --- 3. 标记地图为已加载 ---
        setIsMapLoaded(true);

        // --- 点击事件 ---
        map.current.on('click', async (e) => {
          const features = map.current.queryRenderedFeatures(e.point, {
            layers: ['parcels-fill']
          });

          if (!features.length) return;

          const feature = features[0];
          const objectId = feature.properties.OBJECTID;
          console.log("🎯 点击了真实地块 OBJECTID:", objectId);

          map.current.setFilter('parcels-highlight', ['==', 'OBJECTID', objectId]);
          const featureBounds = bbox(feature);
          const center = [
            (featureBounds[0] + featureBounds[2]) / 2,
            (featureBounds[1] + featureBounds[3]) / 2
          ];
          const screenPt = map.current.project(center);
          setOverlayPos({ x: screenPt.x, y: screenPt.y });
          setClickPoint({ x: e.point.x, y: e.point.y });
          const currentZoom = map.current.getZoom();
          map.current.flyTo({
            center,
            zoom: Math.max(currentZoom, 12.5),
            speed: 0.7,
            curve: 1.15,
            essential: true
          });

          if (highlightPulseRef.current) {
            clearInterval(highlightPulseRef.current);
            highlightPulseRef.current = null;
          }
          let tick = 0;
          highlightPulseRef.current = setInterval(() => {
            tick += 1;
            const wave = (Math.sin(tick * 0.38) + 1) / 2;
            const lineWidth = 3.5 + wave * 4;
            const lineOpacity = 0.55 + wave * 0.45;
            if (map.current && map.current.getLayer('parcels-highlight')) {
              map.current.setPaintProperty('parcels-highlight', 'line-width', lineWidth);
              map.current.setPaintProperty('parcels-highlight', 'line-opacity', lineOpacity);
            }
            if (tick >= 30) {
              clearInterval(highlightPulseRef.current);
              highlightPulseRef.current = null;
              if (map.current && map.current.getLayer('parcels-highlight')) {
                map.current.setPaintProperty('parcels-highlight', 'line-width', 4);
                map.current.setPaintProperty('parcels-highlight', 'line-opacity', 1);
              }
            }
          }, 80);

          try {
            const res = await axios.get(`/api/predict/${objectId}`);
            setSelectedParcel(res.data);
          } catch {
            console.error("获取详情失败");
          }
        });

      } catch (error) {
        console.error("❌ 数据加载或图层绘制流程出错:", error);
      }
    });

    // --- 点击事件 ---
    // 修改 src/components/MapBoard.jsx 中的点击部分

    // --- 鼠标移动事件 (变小手) ---
    map.current.on('mousemove', (e) => {
        // 🔒 安全检查 2：图层不存在时，不要查询，直接返回！
        // 这就是解决你刚才报错的关键代码
        if (!map.current.getLayer('parcels-fill')) return;

        const features = map.current.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] });
        map.current.getCanvas().style.cursor = features.length ? 'pointer' : '';
    });

    return () => {
      clearInterval(intervalRef.current);
      if (highlightPulseRef.current) {
        clearInterval(highlightPulseRef.current);
        highlightPulseRef.current = null;
      }
    };
  }, [setSelectedParcel, setOverlayPos]);

  useEffect(() => {
    if (!map.current || !isMapLoaded) return;
    const years = [2018, 2019, 2020, 2021, 2022];
    const analysisParcelLayers = ['parcels-fill', 'parcels-boundary-casing', 'parcels-boundary', 'parcels-highlight'];

    if (viewMode === 'timeseries') {
      // 遥感影像叠加在地块层下方，保持所有地块图层可见以维持点击/高亮功能
      for (const year of years) {
        if (map.current.getLayer(`raster-layer-${year}`)) {
          map.current.setLayoutProperty(`raster-layer-${year}`, 'visibility', year === currentYear ? 'visible' : 'none');
          // 半透明让地块边界透出
          map.current.setPaintProperty(`raster-layer-${year}`, 'raster-opacity', 0.85);
        }
        if (map.current.getLayer(`change-layer-${year}`)) {
          map.current.setLayoutProperty(`change-layer-${year}`, 'visibility', 'none');
        }
      }
      // 所有地块图层保持可见，确保点击、高亮等交互正常
      for (const layer of analysisParcelLayers) {
        if (map.current.getLayer(layer)) {
          map.current.setLayoutProperty(layer, 'visibility', 'visible');
        }
      }
      // 降低地块填充透明度，让底部遥感影像透出
      if (map.current.getLayer('parcels-fill')) {
        map.current.setPaintProperty('parcels-fill', 'fill-opacity', [
          'match', ['coalesce', ['get', 'risk_level'], 0],
          0, 0.10, 1, 0.14, 2, 0.18, 3, 0.22, 0.12
        ]);
      }
    } else { // analysis mode
      for (const year of years) {
        if (map.current.getLayer(`raster-layer-${year}`)) {
          map.current.setLayoutProperty(`raster-layer-${year}`, 'visibility', 'none');
        }
        if (map.current.getLayer(`change-layer-${year}`)) {
          map.current.setLayoutProperty(`change-layer-${year}`, 'visibility', 'none');
        }
      }
      for (const layer of analysisParcelLayers) {
        if (map.current.getLayer(layer)) {
          map.current.setLayoutProperty(layer, 'visibility', 'visible');
        }
      }
      // 还原地块填充透明度
      if (map.current.getLayer('parcels-fill')) {
        map.current.setPaintProperty('parcels-fill', 'fill-opacity', [
          'match', ['coalesce', ['get', 'risk_level'], 0],
          0, 0.28, 1, 0.36, 2, 0.46, 3, 0.58, 0.3
        ]);
      }
    }
  }, [viewMode, currentYear, isMapLoaded]);

  // 切换模式时停止播放
  useEffect(() => {
    if (viewMode !== 'timeseries') {
      setIsPlaying(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!overlay?.visible || overlay.type !== 'evaluation') return;
    const parcelId = overlay.data?.parcel_id;
    if (!parcelId) return;
    const hasScore = overlay.data?.score !== undefined && overlay.data?.score !== null;
    const hasTop5 = (overlay.data?.top_features_top5 || []).length > 0;
    const hasComponents = overlay.data?.components?.current_score !== undefined ||
      overlay.data?.components?.current !== undefined ||
      overlay.data?.components?.base_score !== undefined ||
      overlay.data?.components?.base !== undefined;
    if (hasScore && hasTop5 && hasComponents) return;

    let cancelled = false;
    const calc = (level, yearlyLevels, top5List) => {
      const levels = [
        yearlyLevels?.[2019] ?? 0,
        yearlyLevels?.[2020] ?? 0,
        yearlyLevels?.[2021] ?? 0,
        yearlyLevels?.[2022] ?? 0
      ];
      const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
      const normalizedLevel = clamp01((Number(level) || 0) / 3);
      const persistence = clamp01(levels.reduce((s, v) => s + v, 0) / (levels.length * 3));
      const trend = clamp01(((yearlyLevels?.[2022] ?? 0) - (yearlyLevels?.[2019] ?? 0)) / 3);
      const recent = clamp01(((yearlyLevels?.[2022] ?? 0) - (yearlyLevels?.[2021] ?? 0)) / 3);
      const strength = top5List.length ? top5List.reduce((s, it) => s + it.value, 0) / top5List.length : 0;
      const featureStrength = clamp01(strength);
      const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
      const variance = levels.reduce((s, v) => s + (v - mean) * (v - mean), 0) / levels.length;
      const volatility = Math.sqrt(variance);
      const currentScore = 40 * normalizedLevel;
      const persistenceScore = 20 * persistence;
      const trendScore = 15 * trend;
      const recentScore = 10 * recent;
      const featureScore = 15 * featureStrength;
      const penalty = -Math.min(10, (volatility / 1.5) * 10);
      const score = Math.max(0, Math.min(100, currentScore + persistenceScore + trendScore + recentScore + featureScore + penalty));
      const mapped = score < 30 ? 0 : score < 50 ? 1 : score < 70 ? 2 : 3;
      return {
        score: Number(score.toFixed(1)),
        level: Number(level) || 0,
        predicted_level: Number(level) || 0,
        score_level: mapped,
        components: {
          current_score: Number(currentScore.toFixed(2)),
          persistence_score: Number(persistenceScore.toFixed(2)),
          trend_score: Number(trendScore.toFixed(2)),
          recent_score: Number(recentScore.toFixed(2)),
          feature_score: Number(featureScore.toFixed(2)),
          volatility_penalty: Number(penalty.toFixed(2))
        }
      };
    };

    const hydrate = async () => {
      try {
        const [predRes, histRes] = await Promise.all([
          axios.get(`/api/predict/${parcelId}`),
          axios.get(`/api/predict_history/${parcelId}?top_k=10`)
        ]);
        if (cancelled) return;
        const pred = predRes.data || {};
        const hist = histRes.data || {};
        const features2023 = hist.yearly_features?.['2023'] || {};
        const sorted = Object.entries(features2023).sort((a, b) => Number(b[1]) - Number(a[1]));
        const top5 = sorted.slice(0, 5).map(([name, value]) => ({ name, value: Number(value) || 0 }));
        const top10 = sorted.slice(0, 10).map(([name, value]) => ({ name, value: Number(value) || 0 }));
        const derived = calc(pred.prediction?.level ?? 0, pred.real_data?.yearly_levels || {}, top5);
        updateOverlayData({
          score: derived.score,
          level: derived.level,
          predicted_level: derived.predicted_level,
          score_level: derived.score_level,
          components: derived.components,
          top_features_top5: top5,
          top_features_top10: top10,
          classes: hist.yearly_classes || overlay.data?.classes
        });
      } catch {
        return;
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [
    overlay?.visible,
    overlay?.type,
    overlay?.data?.parcel_id,
    overlay?.data?.score,
    overlay?.data?.top_features_top5?.length,
    overlay?.data?.components?.base,
    overlay?.data?.components?.base_score,
    overlay?.data?.components?.current,
    overlay?.data?.components?.current_score,
    overlay?.data?.classes,
    overlay?.data?.top_features_top5,
    updateOverlayData
  ]);

  // Effect to handle playback
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentYear(prevYear => {
          if (prevYear === 2022) return 2018;
          return prevYear + 1;
        });
      }, 2000); // 2秒切换一次
    } else {
      clearInterval(intervalRef.current);
    }

    return () => clearInterval(intervalRef.current);
  }, [isPlaying, setCurrentYear]);

  return <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {/* 按钮组底卡 */}
      <div style={{
        position: 'absolute',
        top: 6,
        left: 6,
        width: 52,
        height: 96,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.28)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.55)',
        boxShadow: '0 4px 12px rgba(15,23,42,0.1)',
        zIndex: 989,
        pointerEvents: 'none'
      }} />
      <button
        onClick={() => {
          if (map.current && initialBoundsRef.current) {
            map.current.fitBounds(initialBoundsRef.current, { padding: 20, duration: 600 });
          }
        }}
        title="复位地图"
        style={{
          position: 'absolute',
          top: 56,
          left: 12,
          width: 36,
          height: 36,
          borderRadius: 8,
          border: '1.5px solid rgba(148,163,184,0.4)',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 2px 8px rgba(15,23,42,0.15)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          color: '#334155',
          zIndex: 1000
        }}
      >
        ⌂
      </button>
      <OverlayCard
        overlay={overlay}
        closeOverlay={closeOverlay}
        initialPos={overlayPos}
      />
      {viewMode === 'timeseries' && (
        <TimelineSlider 
          year={currentYear}
          setYear={setCurrentYear}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
        />
      )}
    </div>;
};

export default MapBoard;
