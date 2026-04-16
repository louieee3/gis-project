// src/components/ParcelAnalysisFloat.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import useStore from '../store/useStore';
import * as echarts from 'echarts';
import axios from 'axios';

const COMPARISON_YEARS = [2020, 2021, 2022, 2023];
const MIN_W = 460;
const MIN_H = 360;
const DEFAULT_W = 760;
const DEFAULT_H = 880;

const ParcelAnalysisFloat = () => {
  const selectedParcel = useStore((state) => state.selectedParcel);
  const clearSelection = useStore((state) => state.clearSelection);

  const [topK, setTopK] = useState(10);
  const [featureCatalog, setFeatureCatalog] = useState([]);
  const [isFeatureDrawerOpen, setIsFeatureDrawerOpen] = useState(false);
  const [yearlyRadarData, setYearlyRadarData] = useState({});
  const [yearlyClassData, setYearlyClassData] = useState({});
  const [isChartLoading, setIsChartLoading] = useState(false);

  const [pos, setPos] = useState({ x: 64, y: 8 });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const dragging = useRef(false);
  const resizing = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const radarChartRefs = useRef({});
  const radarInstances = useRef({});
  const deltaChartRef = useRef(null);
  const deltaChartInstance = useRef(null);

  // 新地块被选中时重置尺寸，但保持位置固定
  useEffect(() => {
    if (!selectedParcel) return;
    setSize({ w: DEFAULT_W, h: DEFAULT_H });
  }, [selectedParcel?.parcel_id]);

  const onDragStart = useCallback((e) => {
    if (e.target.closest('.paf-resize')) return;
    dragging.current = true;
    offsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  const onResizeStart = useCallback((e) => {
    resizing.current = true;
    offsetRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    e.preventDefault();
    e.stopPropagation();
  }, [size]);

  useEffect(() => {
    const onMove = (e) => {
      if (dragging.current) {
        setPos({
          x: Math.max(0, Math.min(e.clientX - offsetRef.current.x, window.innerWidth - size.w - 8)),
          y: Math.max(0, Math.min(e.clientY - offsetRef.current.y, window.innerHeight - size.h - 8)),
        });
      }
      if (resizing.current) {
        setSize({
          w: Math.max(MIN_W, offsetRef.current.w + (e.clientX - offsetRef.current.x)),
          h: Math.max(MIN_H, offsetRef.current.h + (e.clientY - offsetRef.current.y)),
        });
      }
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [size]);

  // ---- 辅助函数 ----
  const getFeatureHint = (label) => {
    const text = String(label).toLowerCase();
    if (text.includes('ndvi')) return '植被覆盖相关特征，通常反映生态/农用状态变化。';
    if (text.includes('band')) return '遥感光谱波段特征，反映地物反射差异。';
    if (text.includes('idm')) return '纹理差异特征，反映地表结构变化。';
    if (text.includes('emb')) return '嵌入式表达特征，综合表征地块空间模式。';
    if (text.includes('agm')) return '聚合统计特征，反映局部区域整体变化。';
    return '模型判别用特征维度，可结合年度变化与风险等级联合判断。';
  };

  const friendlyFeatureLabel = (label) => {
    const s = String(label);
    const m = s.match(/^(\d+)-(.+)$/);
    if (!m) return s;
    const [, dim, raw] = m;
    const lower = raw.toLowerCase();
    let readable;
    if (/^ndvi/.test(lower) || lower.includes('ndvi')) readable = raw;
    else if (/^idm(\d+)$/.test(lower)) readable = `纹理特征${lower.match(/\d+/)[0]}`;
    else if (/^band(\d+)$/.test(lower)) readable = `光谱波段${lower.match(/\d+/)[0]}`;
    else if (/^emb(\d+)$/.test(lower)) readable = `空间模式${lower.match(/\d+/)[0]}`;
    else if (/^agm(\d+)$/.test(lower)) readable = `区域统计${lower.match(/\d+/)[0]}`;
    else readable = raw;
    return `${dim}-${readable}`;
  };

  const applyTopKToYearlyData = (yearlyFeatures, requestedTopK) => {
    const yearEntries = Object.entries(yearlyFeatures || {});
    if (yearEntries.length === 0) return {};
    const aggregate = {};
    yearEntries.forEach(([, features]) => {
      Object.entries(features || {}).forEach(([name, value]) => {
        aggregate[name] = (aggregate[name] || 0) + Number(value || 0);
      });
    });
    const selectedKeys = Object.entries(aggregate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, requestedTopK)
      .map(([name]) => name);
    const selectedSet = new Set(selectedKeys);
    const compact = {};
    yearEntries.forEach(([year, features]) => {
      compact[year] = Object.fromEntries(
        Object.entries(features || {}).filter(([name]) => selectedSet.has(name))
      );
    });
    return compact;
  };

  // ---- 加载年度特征 ----
  useEffect(() => {
    if (!selectedParcel?.parcel_id) return;
    const fallbackFeatures = selectedParcel.explainability?.features || {};
    const fallbackData = COMPARISON_YEARS.reduce((acc, year) => {
      acc[String(year)] = fallbackFeatures;
      return acc;
    }, {});
    let cancelled = false;
    const load = async () => {
      setIsChartLoading(true);
      try {
        const res = await axios.get(`/api/predict_history/${selectedParcel.parcel_id}`, { params: { top_k: topK } });
        if (cancelled) return;
        const fetched = res.data?.yearly_features || {};
        const fetchedClasses = res.data?.yearly_classes || {};
        const fetchedCatalog = res.data?.feature_catalog || [];
        const compactFetched = applyTopKToYearlyData(fetched, topK);
        setYearlyRadarData({ ...fallbackData, ...compactFetched });
        setYearlyClassData(fetchedClasses);
        if (fetchedCatalog.length > 0) {
          setFeatureCatalog(fetchedCatalog.slice(0, topK));
        } else {
          setFeatureCatalog(Object.keys(compactFetched[String(COMPARISON_YEARS[0])] || {}).map((key) => ({ label: key, dimension: key, name: key })));
        }
      } catch {
        if (!cancelled) {
          setYearlyRadarData(fallbackData);
          setYearlyClassData({});
          setFeatureCatalog(Object.keys(fallbackFeatures).map((key) => ({ label: key, dimension: key, name: key })));
        }
      } finally {
        if (!cancelled) setIsChartLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedParcel, topK]);

  // ---- 雷达图 ----
  useEffect(() => {
    if (!selectedParcel || isChartLoading) return;
    const instances = radarInstances.current;
    const palette = ['#1f77b4', '#2a9d8f', '#f4a261', '#e76f51'];
    COMPARISON_YEARS.forEach((year, index) => {
      const refNode = radarChartRefs.current[year];
      if (!refNode) return;
      if (!instances[year] || instances[year].getDom() !== refNode) {
        instances[year]?.dispose();
        instances[year] = echarts.init(refNode);
      }
      const features = yearlyRadarData[String(year)] || selectedParcel.explainability.features;
      const featureKeys = Object.keys(features);
      const classLabel = yearlyClassData[String(year)] || 'None';
      const alpha = 0.22 + index * 0.12;
      const color = palette[index];
      const values = featureKeys.map(key => Number(features[key] ?? 0));
      const dataMax = Math.max(...values, 0.001);
      const radarMax = Math.ceil(dataMax * 12) / 10;
      instances[year].setOption({
        title: { text: `${year}年`, left: 'center', top: 2, textStyle: { fontSize: 12, color: '#333', fontWeight: 600 } },
        legend: { data: [`${classLabel}`], bottom: 0, left: 'center', itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 10, color: '#666' } },
        tooltip: { trigger: 'item', confine: false, appendToBody: true, renderMode: 'html', enterable: true, extraCssText: 'z-index: 99999; box-shadow: 0 6px 20px rgba(0,0,0,0.18);' },
        radar: {
          indicator: featureKeys.map(key => ({ name: friendlyFeatureLabel(key), max: radarMax })),
          axisName: { color: '#666', fontSize: 10, formatter: (name) => name.length <= 8 ? name : `${name.slice(0, 8)}…` },
          center: ['50%', '52%'], radius: '60%',
          splitArea: { areaStyle: { color: ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.03)'] } }
        },
        series: [{
          type: 'radar',
          data: [{
            value: featureKeys.map(key => Number(features[key] ?? 0)),
            name: `${classLabel}`,
            tooltip: {
              formatter: (params) => {
                const indicators = featureKeys.map(k => friendlyFeatureLabel(k));
                return indicators.map((name, i) => `${name}: ${params.value[i]?.toFixed(4) ?? '-'}`).join('<br/>');
              }
            }
          }],
          areaStyle: { color: `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` },
          lineStyle: { color, width: 2 },
          itemStyle: { color }
        }]
      });
    });
    const handleResize = () => { COMPARISON_YEARS.forEach((year) => { instances[year]?.resize(); }); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedParcel, yearlyRadarData, yearlyClassData, isChartLoading]);

  // 图表实例清理
  useEffect(() => {
    const instances = radarInstances.current;
    return () => {
      COMPARISON_YEARS.forEach((year) => { instances[year]?.dispose(); instances[year] = null; });
      deltaChartInstance.current?.dispose();
      deltaChartInstance.current = null;
    };
  }, []);

  // ---- 差值柱状图 ----
  useEffect(() => {
    if (!selectedParcel || !deltaChartRef.current || isChartLoading) return;
    if (!deltaChartInstance.current || deltaChartInstance.current.getDom() !== deltaChartRef.current) {
      deltaChartInstance.current?.dispose();
      deltaChartInstance.current = echarts.init(deltaChartRef.current);
    }
    const baseYear = String(COMPARISON_YEARS[0]);
    const targetYear = String(COMPARISON_YEARS[COMPARISON_YEARS.length - 1]);
    const baseFeatures = yearlyRadarData[baseYear] || {};
    const targetFeatures = yearlyRadarData[targetYear] || {};
    const allKeys = Array.from(new Set([...Object.keys(baseFeatures), ...Object.keys(targetFeatures)]));
    const diffRows = allKeys
      .map((name) => ({ name: friendlyFeatureLabel(name), value: Number((targetFeatures[name] ?? 0) - (baseFeatures[name] ?? 0)) }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6)
      .reverse();
    deltaChartInstance.current.setOption({
      title: { text: `${targetYear} vs ${baseYear} 年度差值 Top6`, left: 'left', top: 2, textStyle: { fontSize: 13, color: '#334155', fontWeight: 600 } },
      grid: { top: 34, left: 90, right: 26, bottom: 18, containLabel: false },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, appendToBody: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
      yAxis: { type: 'category', data: diffRows.map((d) => d.name), axisLabel: { fontSize: 11, color: '#475569' } },
      series: [{
        type: 'bar',
        data: diffRows.map((d) => ({ value: Number(d.value.toFixed(4)), itemStyle: { color: d.value >= 0 ? '#16a34a' : '#dc2626' } })),
        barWidth: 12,
        label: { show: true, position: 'right', fontSize: 10, color: '#475569', formatter: ({ value }) => `${value > 0 ? '+' : ''}${value}` }
      }]
    });
    const handleDeltaResize = () => { deltaChartInstance.current?.resize(); };
    window.addEventListener('resize', handleDeltaResize);
    return () => window.removeEventListener('resize', handleDeltaResize);
  }, [selectedParcel, yearlyRadarData, isChartLoading]);

  if (!selectedParcel) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255,255,255,0.97)',
        border: '1px solid rgba(148,163,184,0.35)',
        borderRadius: 14,
        boxShadow: '0 16px 40px rgba(15,23,42,0.22)',
        overflow: 'hidden',
        backdropFilter: 'blur(6px)'
      }}
    >
      {/* 标题栏 — 可拖动 */}
      <div
        onMouseDown={onDragStart}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'linear-gradient(90deg, #1e3a5f 0%, #2563eb 100%)',
          cursor: 'move',
          userSelect: 'none',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>⚙ 地块分析</span>
          <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 11, padding: '1px 8px', borderRadius: 10 }}>
            ID: {selectedParcel.parcel_id}
          </span>
        </div>
        <button
          onClick={clearSelection}
          style={{ border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', borderRadius: 4, width: 24, height: 24, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          ✕
        </button>
      </div>

      {/* 内容滚动区 */}
      <div className="analysis-scroll-area" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 14px', minHeight: 0 }}>

        {/* 风险等级卡片 */}
        <div style={{
          background: selectedParcel.prediction.level >= 2 ? '#fff5f5' : '#f0f9eb',
          padding: '12px 15px',
          borderRadius: '8px',
          marginBottom: '14px',
          border: `1px solid ${selectedParcel.prediction.level >= 2 ? '#feb2b2' : '#c2e7b0'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '18px', color: selectedParcel.prediction.level >= 2 ? '#c53030' : '#2f855a' }}>
            预测风险：{selectedParcel.prediction.level} 级
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            置信度: <strong>{(selectedParcel.prediction.confidence * 100).toFixed(1)}%</strong>
          </div>
        </div>

        {/* 图表标题与控制 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h4 style={{ margin: 0, color: '#333', fontSize: 13 }}>非农化特征贡献</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {[5, 10].map((value) => (
              <button
                key={value}
                onClick={() => setTopK(value)}
                style={{
                  border: '1px solid #d1d9e6', borderRadius: '999px', fontSize: '11px',
                  padding: '2px 8px', cursor: 'pointer',
                  background: topK === value ? '#2563eb' : '#fff',
                  color: topK === value ? '#fff' : '#334155'
                }}
              >
                Top{value}
              </button>
            ))}
            <button
              onClick={() => setIsFeatureDrawerOpen((prev) => !prev)}
              style={{ border: '1px solid #d1d9e6', borderRadius: '8px', fontSize: '11px', padding: '2px 8px', cursor: 'pointer', background: '#fff', color: '#334155' }}
            >
              特征说明
            </button>
          </div>
        </div>

        {/* 图表网格 */}
        {isChartLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={`skeleton-${idx}`} style={{ height: 220, borderRadius: '10px', background: '#f8fbff', border: '1px solid #e7eef9', overflow: 'hidden' }}>
                <div className="skeleton-shimmer" style={{ width: '100%', height: '100%' }} />
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', height: '180px', borderRadius: '10px', background: '#f8fbff', border: '1px solid #e7eef9', overflow: 'hidden' }}>
              <div className="skeleton-shimmer" style={{ width: '100%', height: '100%' }} />
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {COMPARISON_YEARS.map((year) => (
                <div
                  key={year}
                  style={{ width: '100%', minWidth: 0, height: 220, border: '1px solid #eef1f4', borderRadius: '8px', padding: '4px', overflow: 'visible', boxSizing: 'border-box', background: '#fff' }}
                >
                  <div ref={(el) => { radarChartRefs.current[year] = el; }} style={{ width: '100%', height: '100%' }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: '12px', height: '180px', border: '1px solid #eef2f7', borderRadius: '10px', background: '#fff', padding: '8px' }}>
              <div ref={deltaChartRef} style={{ width: '100%', height: '100%' }} />
            </div>
          </>
        )}
      </div>

      {/* 特征说明抽屉 */}
      {isFeatureDrawerOpen && (
        <div className="feature-drawer-scroll" style={{
          position: 'absolute', top: 42, right: 10, width: 260, maxHeight: '60%',
          overflowY: 'auto', background: 'rgba(255,255,255,0.98)',
          border: '1px solid #dbe3f0', borderRadius: '12px',
          boxShadow: '0 14px 36px rgba(15,23,42,0.22)', zIndex: 1500, padding: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ fontSize: '13px', color: '#1f2937' }}>Top{topK} 特征说明</strong>
            <button onClick={() => setIsFeatureDrawerOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>✕</button>
          </div>
          {featureCatalog.map((item, idx) => (
            <div key={`${item.label}-${idx}`} style={{ borderBottom: '1px solid #edf2f7', padding: '8px 0' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{item.label}</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{getFeatureHint(item.label)}</div>
            </div>
          ))}
        </div>
      )}

      {/* 右下角拉伸手柄 */}
      <div
        className="paf-resize"
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 18, height: 18,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.5) 50%)',
          borderRadius: '0 0 14px 0'
        }}
      />
    </div>
  );
};

export default ParcelAnalysisFloat;
