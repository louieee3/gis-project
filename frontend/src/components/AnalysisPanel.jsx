// src/components/AnalysisPanel.jsx
import React from 'react';
import ChatBox from './ChatBox';
import HistoryPanel from './HistoryPanel';

const AnalysisPanel = () => {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: '#ffffff',
      borderRadius: 12
    }}>
      {/* 标题栏 */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid #e2e8f0',
        flexShrink: 0,
        background: 'linear-gradient(90deg, #1e3a5f 0%, #2563eb 100%)',
        borderRadius: '12px 12px 0 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <span style={{ fontSize: 15 }}>💬</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>智能问答</span>
      </div>

      {/* 对话内容区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, padding: '8px 10px' }}>
        <HistoryPanel />
        <ChatBox />
      </div>
    </div>
  );
};

export default AnalysisPanel;