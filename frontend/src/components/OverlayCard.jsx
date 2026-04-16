// src/components/OverlayCard.jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';

const MIN_W = 460;
const MIN_H = 360;
const DEFAULT_W = 700;
const DEFAULT_H = 1000;

// 风险等级颜色
const LEVEL_COLOR = {
  0: { bg: '#f0fdf4', border: '#86efac', text: '#15803d', label: '低风险' },
  1: { bg: '#fefce8', border: '#fde047', text: '#a16207', label: '中低风险' },
  2: { bg: '#fff7ed', border: '#fdba74', text: '#c2410c', label: '中高风险' },
  3: { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', label: '高风险' },
};

const getLevelStyle = (level) => LEVEL_COLOR[level] || LEVEL_COLOR[0];

const ScoreRing = ({ score, fontSize = 13 }) => {
  const pct = Math.min(Math.max(Number(score) || 0, 0), 100);
  const color = pct >= 70 ? '#dc2626' : pct >= 40 ? '#f97316' : '#16a34a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <svg width={56} height={56} viewBox="0 0 56 56">
        <circle cx={28} cy={28} r={23} fill="none" stroke="#e2e8f0" strokeWidth={5} />
        <circle
          cx={28} cy={28} r={23} fill="none"
          stroke={color} strokeWidth={5}
          strokeDasharray={`${2 * Math.PI * 23}`}
          strokeDashoffset={`${2 * Math.PI * 23 * (1 - pct / 100)}`}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text x={28} y={33} textAnchor="middle" fontSize={Math.max(11, fontSize - 2)} fontWeight={700} fill={color}>{pct}</text>
      </svg>
      <div>
        <div style={{ fontSize: Math.max(9, fontSize - 4), color: '#64748b', marginBottom: 2 }}>综合评分</div>
        <div style={{ fontSize: Math.round(fontSize * 1.7), fontWeight: 800, color, lineHeight: 1 }}>{pct}<span style={{ fontSize: Math.max(10, fontSize - 1), fontWeight: 400, color: '#94a3b8' }}> / 100</span></div>
      </div>
    </div>
  );
};

const FeatureBar = ({ feature, maxVal, fontSize = 13 }) => {
  const val = Number(feature.value) || 0;
  const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
  const name = String(feature.name || feature.label || '');
  // 友好名称
  const m = name.match(/^(\d+)-(.+)$/);
  let friendly = name;
  if (m) {
    const [, dim, raw] = m;
    const lower = raw.toLowerCase();
    if (/^idm(\d+)$/.test(lower)) friendly = `${dim}-纹理特征${lower.match(/\d+/)[0]}`;
    else if (/^band(\d+)$/.test(lower)) friendly = `${dim}-光谱波段${lower.match(/\d+/)[0]}`;
    else if (/^emb(\d+)$/.test(lower)) friendly = `${dim}-空间模式${lower.match(/\d+/)[0]}`;
    else if (/^agm(\d+)$/.test(lower)) friendly = `${dim}-区域统计${lower.match(/\d+/)[0]}`;
    else friendly = name;
  }
  const barColor = pct > 66 ? '#2563eb' : pct > 33 ? '#7c3aed' : '#06b6d4';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: Math.max(10, fontSize - 2), color: '#334155', marginBottom: 2 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{friendly}</span>
        <span style={{ color: '#64748b', flexShrink: 0 }}>{val.toFixed(4)}</span>
      </div>
      <div style={{ height: 5, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 999, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
};

const OverlayCard = ({ overlay, closeOverlay, initialPos }) => {
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  // 基于宽度动态推导字号：420px→13px，700px→18px（上限）
  const fontSize = Math.min(18, Math.max(13, 13 + (size.w - 420) * (5 / 280)));
  const dragging = useRef(false);
  const resizing = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const cardRef = useRef(null);

  // 初始位置：与 ParcelAnalysisFloat（左侧 x=64, y=8）对称，放在父容器右侧
  useEffect(() => {
    const parent = cardRef.current?.parentElement;
    const containerW = parent?.clientWidth || window.innerWidth;
    const containerH = parent?.clientHeight || window.innerHeight;
    // 右侧对称：距右边缘 64px
    const rightX = containerW - DEFAULT_W - 64;
    // 确保不超出容器
    const safeX = Math.max(8, Math.min(rightX, containerW - DEFAULT_W - 8));
    const safeY = Math.max(8, Math.min(8, containerH - DEFAULT_H - 8));
    setPos({ x: safeX, y: safeY });
    setSize({ w: DEFAULT_W, h: DEFAULT_H });
  }, [overlay?.data?.parcel_id]);

  const onDragStart = useCallback((e) => {
    if (e.target.closest('.oc-resize-handle')) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  const onResizeStart = useCallback((e) => {
    resizing.current = true;
    offset.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    e.preventDefault();
    e.stopPropagation();
  }, [size]);

  useEffect(() => {
    const onMove = (e) => {
      if (dragging.current) {
        const newX = e.clientX - offset.current.x;
        const newY = e.clientY - offset.current.y;
        const maxX = window.innerWidth - size.w - 8;
        const maxY = window.innerHeight - size.h - 8;
        setPos({ x: Math.max(0, Math.min(newX, maxX)), y: Math.max(0, Math.min(newY, maxY)) });
      }
      if (resizing.current) {
        const dw = e.clientX - offset.current.x;
        const dh = e.clientY - offset.current.y;
        setSize({ w: Math.max(MIN_W, offset.current.w + dw), h: Math.max(MIN_H, offset.current.h + dh) });
      }
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  if (!overlay?.visible) return null;

  const d = overlay.data || {};
  const displayLevel = d.predicted_level ?? d.level ?? 0;
  const scoreLevel = d.score_level;
  const levelStyle = getLevelStyle(displayLevel);
  const features = d.top_features_top10 || d.top_features_top5 || d.top_features || [];
  const maxFeatureVal = features.length > 0 ? Math.max(...features.map(f => Number(f.value) || 0)) : 1;

  return (
    <div
      ref={cardRef}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255,255,255,0.98)',
        border: '1px solid rgba(148,163,184,0.3)',
        borderRadius: 14,
        boxShadow: '0 20px 50px rgba(15,23,42,0.22)',
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
        userSelect: dragging.current ? 'none' : 'auto',
      }}
    >
      {/* 标题栏 */}
      <div
        onMouseDown={onDragStart}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 12px',
          background: 'linear-gradient(90deg, #1e3a5f 0%, #2563eb 100%)',
          cursor: 'move',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: Math.max(13, fontSize) }}>📊</span>
          <span style={{ color: '#fff', fontSize: fontSize, fontWeight: 700 }}>
            {overlay.type === 'evaluation' ? '非农化评价' : '非农化预测'}
          </span>
          {d.parcel_id && (
            <span style={{
              fontSize: Math.max(9, fontSize - 4), color: 'rgba(255,255,255,0.65)',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 4, padding: '1px 6px',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>ID: {d.parcel_id}</span>
          )}
        </div>
        <button
          onClick={closeOverlay}
          style={{
            border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff',
            borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: fontSize,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.35)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
        >✕</button>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 0 }}
        className="oc-scroll">

        {/* 结果 */}
        {d.score !== undefined && d.score !== null && (
          <>
            {/* 评分环 */}
            <ScoreRing score={d.score} fontSize={fontSize} />

            {/* 风险等级 + 置信度 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{
                flex: 1, padding: '8px 10px', borderRadius: 8,
                background: levelStyle.bg, border: `1px solid ${levelStyle.border}`,
              }}>
                <div style={{ fontSize: Math.max(9, fontSize - 4), color: '#64748b', marginBottom: 2 }}>预测风险等级</div>
                <div style={{ fontSize: Math.max(13, fontSize + 2), fontWeight: 700, color: levelStyle.text }}>
                  {displayLevel} 级
                  <span style={{ fontSize: Math.max(9, fontSize - 4), fontWeight: 400, marginLeft: 4, opacity: 0.8 }}>
                    {levelStyle.label}
                  </span>
                </div>
                {scoreLevel !== undefined && scoreLevel !== null && (
                  <div style={{ fontSize: Math.max(9, fontSize - 4), color: '#64748b', marginTop: 4 }}>
                    评分映射等级: {scoreLevel} 级
                  </div>
                )}
              </div>
              <div style={{
                flex: 1, padding: '8px 10px', borderRadius: 8,
                background: '#f8faff', border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: Math.max(9, fontSize - 4), color: '#64748b', marginBottom: 4 }}>置信度</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 5, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((d.confidence || 0) * 100)}%`, background: '#2563eb', borderRadius: 999 }} />
                  </div>
                  <span style={{ fontSize: Math.max(11, fontSize - 1), fontWeight: 600, color: '#1d4ed8' }}>{Math.round((d.confidence || 0) * 100)}%</span>
                </div>
              </div>
            </div>

            {/* 评分拆解 */}
            <div style={{
              marginBottom: 12, padding: '10px 12px', borderRadius: 8,
              background: '#f8faff', border: '1px solid #e2e8f0'
            }}>
              <div style={{ fontSize: Math.max(10, fontSize - 2), fontWeight: 600, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                评分拆解
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                {[
                  { label: '当前风险', value: d.components?.current_score ?? d.components?.current ?? d.components?.base_score ?? d.components?.base ?? 0, color: '#2563eb' },
                  { label: '风险持续性', value: d.components?.persistence_score ?? d.components?.persistence ?? 0, color: '#0f766e' },
                  { label: '长期趋势', value: d.components?.trend_score ?? d.components?.trend ?? 0, color: '#7c3aed' },
                  { label: '近期变化', value: d.components?.recent_score ?? d.components?.recent ?? 0, color: '#c2410c' },
                  { label: '特征强度', value: d.components?.feature_score ?? d.components?.feature ?? 0, color: '#0891b2' },
                  { label: '波动惩罚', value: d.components?.volatility_penalty ?? d.components?.penalty ?? 0, color: '#dc2626' },
                ].map(item => (
                  <div key={item.label} style={{
                    padding: '6px 8px', borderRadius: 6,
                    background: '#fff', border: '1px solid #f1f5f9'
                  }}>
                    <div style={{ fontSize: Math.max(9, fontSize - 4), color: '#64748b' }}>{item.label}</div>
                    <div style={{ fontSize: Math.max(12, fontSize + 1), fontWeight: 700, color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 历史类别 */}
            {d.classes && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {Object.entries(d.classes).map(([yr, cls]) => (
                  <div key={yr} style={{
                    flex: 1, textAlign: 'center', padding: '5px 4px', borderRadius: 6,
                    background: cls === 'High' ? '#fef2f2' : cls === 'Medium' ? '#fff7ed' : '#f0fdf4',
                    border: `1px solid ${cls === 'High' ? '#fca5a5' : cls === 'Medium' ? '#fdba74' : '#86efac'}`,
                    fontSize: Math.max(10, fontSize - 2)
                  }}>
                    <div style={{ color: '#64748b', fontSize: Math.max(9, fontSize - 4) }}>{yr}年</div>
                    <div style={{ fontWeight: 600, color: cls === 'High' ? '#b91c1c' : cls === 'Medium' ? '#c2410c' : '#15803d' }}>{cls || 'None'}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Top10 特征 */}
            {features.length > 0 && (
              <div>
                <div style={{ fontSize: Math.max(10, fontSize - 2), fontWeight: 600, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  贡献特征 Top{features.length}
                </div>
                {features.map((f, idx) => (
                  <FeatureBar key={idx} feature={f} maxVal={maxFeatureVal} fontSize={fontSize} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 右下拉伸手柄 */}
      <div
        className="oc-resize-handle"
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 18, height: 18,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.5) 50%)',
          borderRadius: '0 0 14px 0',
          zIndex: 10
        }}
      />
    </div>
  );
};

export default OverlayCard;
