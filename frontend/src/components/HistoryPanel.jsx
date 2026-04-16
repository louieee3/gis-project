import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';

const HistoryPanel = () => {
  const chatHistory = useStore((state) => state.chatHistory);
  const clearChatHistory = useStore((state) => state.clearChatHistory);
  const [expandedIndex, setExpandedIndex] = useState(null);
  const containerRef = useRef(null);
  const [fontSize, setFontSize] = useState(13);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const size = Math.min(16, Math.max(12, 12 + (w - 320) * (4 / 280)));
      setFontSize(Math.round(size * 10) / 10);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (chatHistory.length === 0) return null;

  return (
    <div ref={containerRef} style={{
      flexShrink: 0,
      maxHeight: '38%',
      display: 'flex',
      flexDirection: 'column',
      borderBottom: '1px solid #e8edf5',
      paddingBottom: 8,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: fontSize }}></span>
          <span style={{ fontSize: fontSize, fontWeight: 700, color: '#334155' }}>历史对话</span>
          <span style={{
            fontSize: Math.max(9, fontSize - 3), background: '#eff6ff', color: '#2563eb',
            borderRadius: 99, padding: '1px 6px', border: '1px solid #dbeafe'
          }}>{chatHistory.length}</span>
        </div>
        <button
          onClick={clearChatHistory}
          style={{
            background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
            padding: '2px 8px', cursor: 'pointer', fontSize: Math.max(10, fontSize - 2), color: '#64748b',
            display: 'flex', alignItems: 'center', gap: 3
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#fca5a5'; e.currentTarget.style.color = '#dc2626'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b'; }}
        >
           清除
        </button>
      </div>

      <div className="history-scroll-area" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {chatHistory.map((chat, index) => {
          const isOpen = expandedIndex === index;
          const userMsg = chat.messages.find(m => m.role === 'user');
          const preview = userMsg?.content?.slice(0, 30) || '...';
          const timeStr = new Date(chat.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          const dateStr = new Date(chat.timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

          return (
            <div key={index} style={{ marginBottom: 4 }}>
              <div
                onClick={() => setExpandedIndex(isOpen ? null : index)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '5px 8px', borderRadius: 7, cursor: 'pointer',
                  background: isOpen ? '#eff6ff' : '#f8fafc',
                  border: `1px solid ${isOpen ? '#bfdbfe' : '#e8edf5'}`,
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: Math.max(10, fontSize - 1), color: '#2563eb', flexShrink: 0 }}>{isOpen ? '' : ''}</span>
                <span style={{
                  fontSize: Math.max(9, fontSize - 3), background: '#dbeafe', color: '#1d4ed8',
                  borderRadius: 4, padding: '1px 5px', flexShrink: 0, fontWeight: 600
                }}>
                  {chat.id?.toString().slice(-4) ?? '??'}
                </span>
                <span style={{ flex: 1, fontSize: Math.max(10, fontSize - 1), color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {preview}{userMsg?.content?.length > 30 ? '' : ''}
                </span>
                <span style={{ fontSize: Math.max(9, fontSize - 3), color: '#94a3b8', flexShrink: 0 }}>{dateStr} {timeStr}</span>
              </div>

              {isOpen && (
                <div style={{
                  margin: '3px 0 3px 8px', padding: '8px 10px',
                  background: '#f8fafc', borderRadius: '0 0 7px 7px',
                  border: '1px solid #e2e8f0', borderTop: 'none',
                  display: 'flex', flexDirection: 'column', gap: 6
                }}>
                  {chat.messages.map((msg, msgIndex) => (
                    <div key={msgIndex} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '88%', padding: '5px 9px', borderRadius: 8, fontSize: Math.max(10, fontSize - 1),
                        background: msg.role === 'user' ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : '#fff',
                        color: msg.role === 'user' ? '#fff' : '#334155',
                        border: msg.role === 'user' ? 'none' : '1px solid #e8edf5',
                        lineHeight: 1.55,
                        wordBreak: 'break-word',
                      }}>
                        {msg.content || (msg.role === 'assistant' ? <em style={{ opacity: 0.4 }}>(空)</em> : '')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HistoryPanel;