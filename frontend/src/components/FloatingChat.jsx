// src/components/FloatingChat.jsx
import React from 'react';
import useStore from '../store/useStore';

const FloatingChat = () => {
  const viewMode = useStore((state) => state.viewMode);
  const setViewMode = useStore((state) => state.setViewMode);
  const isTimeseries = viewMode === 'timeseries';

  return (
    <button
      onClick={() => setViewMode(isTimeseries ? 'analysis' : 'timeseries')}
      title={isTimeseries ? '切换到地块分析模式' : '切换到影像时序模式'}
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        width: 36,
        height: 36,
        padding: 0,
        borderRadius: 8,
        border: `1.5px solid ${isTimeseries ? 'rgba(37,99,235,0.7)' : 'rgba(148,163,184,0.5)'}`,
        background: isTimeseries ? 'rgba(37,99,235,0.92)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(4px)',
        color: isTimeseries ? '#fff' : '#334155',
        fontSize: 18,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(15,23,42,0.15)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s ease'
      }}
    >
      {isTimeseries ? '⚙' : '📷'}
    </button>
  );
};

export default FloatingChat;
