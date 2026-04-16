import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store/useStore';

// 思考过程块：流式阶段默认展开，内容到达后自动收起，之后可手动切换
const ThinkingBlock = ({ thinking, hasContent, fontSize }) => {
  const [open, setOpen] = useState(true);
  const closedRef = useRef(false);
  const detailsRef = useRef(null);

  useEffect(() => {
    if (hasContent && !closedRef.current) {
      closedRef.current = true;
      setOpen(false);
    }
  }, [hasContent]);

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ marginBottom: 8 }}
    >
      <summary style={{ cursor: 'pointer', fontSize: Math.max(10, fontSize - 2), color: '#64748b', userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9658;</span>
        <span>思考过程{hasContent ? '（已完成）' : '…'}</span>
      </summary>
      <div style={{
        background: 'rgba(0,0,0,0.04)', border: '1px dashed rgba(0,0,0,0.1)',
        padding: '8px 10px', borderRadius: 6, marginTop: 6,
        fontSize: Math.max(10, fontSize - 1), color: '#475569', lineHeight: 1.6
      }}>
        {thinking.split('\n').map((line, j) => <div key={j}>{line}</div>)}
      </div>
    </details>
  );
};

// 打字机速度：每帧揭示字符数 & 帧间隔(ms)
// Vite dev proxy 会缓冲整个响应一次性下发，必须用打字机重放来营造流式视觉
const REVEAL_CHARS = 3;  // 每帧揭示3字符
const REVEAL_MS    = 16; // ~60fps

const ChatBox = () => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const typingTimerRef  = useRef(null);  // 打字机 setInterval 句柄
  const revealIndexRef  = useRef(0);     // 已揭示到第几个字符
  const fullThinkingRef = useRef('');    // 后端发来的完整 thinking 文本

  const { selectedParcel, addChatToHistory, openOverlay, updateOverlayData } = useStore();

  const messagesContainerRef = useRef(null);
  const containerRef = useRef(null);
  const prevParcelIdRef = useRef(undefined);
  const messagesRef = useRef([]);
  const isStreamingRef = useRef(false);
  const pendingClearRef = useRef(false);
  const abortRef = useRef(null);
  const [fontSize, setFontSize] = useState(13);

  // 根据容器宽度动态计算字号，最小12px，最大16px
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      // 320px -> 12px, 600px -> 16px, 线性插值并 clamp
      const size = Math.min(16, Math.max(12, 12 + (w - 320) * (4 / 280)));
      setFontSize(Math.round(size * 10) / 10);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const currentParcelId = selectedParcel?.parcel_id;
    const previousParcelId = prevParcelIdRef.current;

    if (previousParcelId !== undefined && currentParcelId !== previousParcelId) {
      const currentMessages = messagesRef.current;
      if (currentMessages.length > 0) {
        addChatToHistory({
          id: previousParcelId,
          timestamp: new Date(),
          messages: currentMessages,
        });
      }
      if (!isStreamingRef.current) {
        setMessages([]);
      } else {
        pendingClearRef.current = true;
      }
    }

    prevParcelIdRef.current = currentParcelId;
  }, [selectedParcel, addChatToHistory]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messagesRef.current, userMessage, { role: 'assistant', content: '', thinking: '' }];
    setMessages(newMessages);
    setInput('');
    isStreamingRef.current = true;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, context: selectedParcel }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 buffer 提取 thinking / content / ui_eval
        let newThinking = '';
        let newContent = '';
        let evalDone = false;

        if (buffer.includes('</thinking>')) {
          const parts = buffer.split('</thinking>');
          newThinking = parts[0].replace('<thinking>', '');
          newContent = parts[1] || '';
          const evalMatch = newContent.match(/<ui_eval>([\s\S]*?)<\/ui_eval>/);
          if (evalMatch) {
            try {
              const payload = JSON.parse(evalMatch[1]);
              queueMicrotask(() => {
                openOverlay({ ...payload, processing: false });
              });
              evalDone = true;
              newContent = newContent.replace(/<ui_eval>[\s\S]*?<\/ui_eval>/, '').trim();
            } catch { /* ignore */ }
          } else {
            newContent = newContent.replace(/<ui_eval>[\s\S]*/g, '').trim();
          }
        } else if (buffer.startsWith('<thinking>')) {
          newThinking = buffer.replace('<thinking>', '');
          newContent = '';
        } else if ('<thinking>'.startsWith(buffer.trim())) {
          // buffer 是 <thinking> 标签的不完整前缀（如 "<thin"），等待更多 chunk
          newThinking = '';
          newContent = '';
        } else {
          newContent = buffer;
        }

        // ── thinking 打字机 ──────────────────────────────────────────
        // 每个 chunk 到达时更新 fullThinkingRef（完整目标文本）
        // 打字机定时器以固定速率从 fullThinkingRef 向 msg.thinking 揭示字符
        // 效果：无论代理是否缓冲，thinking 都以平滑速度逐字出现
        if (newThinking !== fullThinkingRef.current) {
          fullThinkingRef.current = newThinking;
          // 定时器只启动一次，后续帧自动追上新增文本
          if (!typingTimerRef.current) {
            revealIndexRef.current = 0;
            typingTimerRef.current = setInterval(() => {
              const target = fullThinkingRef.current;
              revealIndexRef.current = Math.min(revealIndexRef.current + REVEAL_CHARS, target.length);
              const revealed = target.slice(0, revealIndexRef.current);
              setMessages(prev => {
                const msgs = [...prev];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') { last.thinking = revealed; }
                return msgs;
              });
              // 揭示完毕后自行清理（不依赖 isStreamingRef，避免竞态）
              if (revealIndexRef.current >= target.length) {
                clearInterval(typingTimerRef.current);
                typingTimerRef.current = null;
                revealIndexRef.current = 0;
                fullThinkingRef.current = '';
              }
            }, REVEAL_MS);
          }
        }

        // ── content / evalDone：仅在 </thinking> 之后出现 ───────────
        // ThinkingBlock.hasContent 变 true 时会自动触发收起
        if (newContent || evalDone) {
          setMessages(prevMessages => {
            const updatedMessages = [...prevMessages];
            if (updatedMessages.length === 0) return prevMessages;
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            if (!lastMessage || lastMessage.role !== 'assistant') return prevMessages;
            if (newContent) {
              lastMessage.content = newContent;
            } else if (evalDone && !lastMessage.content) {
              lastMessage.content = '评价结果已打开 ↗';
            }
            return updatedMessages;
          });
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        if (updated.length === 0) return prev;
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          last.content = `连接 AI 失败: ${err.message}`;
          last.thinking = '';
        }
        return updated;
      });
    } finally {
      // 流结束：仅标记状态，不提前写入 thinking——让定时器自然跑完后清理
      isStreamingRef.current = false;
      // 安全兜底：若 3s 后定时器仍未退出，强制清除并补全最终文本
      setTimeout(() => {
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
          // 补全剩余未揭示的字符
          if (fullThinkingRef.current) {
            const full = fullThinkingRef.current;
            setMessages(prev => {
              const msgs = [...prev];
              const last = msgs[msgs.length - 1];
              if (last?.role === 'assistant') { last.thinking = full; }
              return msgs;
            });
          }
          fullThinkingRef.current = '';
          revealIndexRef.current = 0;
        }
      }, 3000);
      if (pendingClearRef.current) {
        pendingClearRef.current = false;
        setMessages([]);
      }
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', minHeight: 0 }}>
      <div
        className="chat-scroll-area"
        ref={messagesContainerRef}
        style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', fontSize: fontSize, display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 4 }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 24 }}>
            {selectedParcel ? '对当前地块提问' : '请先在地图上点击地块'}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '90%',
              padding: '8px 11px',
              borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
              background: msg.role === 'user' ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : '#f1f5f9',
              color: msg.role === 'user' ? '#fff' : '#0f172a',
              fontSize: fontSize,
              lineHeight: 1.6,
              boxShadow: '0 1px 3px rgba(15,23,42,0.08)'
            }}>
              {msg.thinking && (
                <ThinkingBlock
                  thinking={msg.thinking}
                  hasContent={!!msg.content}
                  fontSize={fontSize}
                />
              )}
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.content || (isStreamingRef.current && i === messages.length - 1 ? <span style={{ opacity: 0.5 }}></span> : '')}
              </div>
            </div>
            <div style={{ fontSize: Math.max(9, fontSize - 3), color: '#94a3b8', marginTop: 2, paddingLeft: 4, paddingRight: 4 }}>
              {msg.role === 'user' ? '你' : '助手'}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        display: 'flex', gap: 8, padding: '8px', marginTop: 8,
        background: 'linear-gradient(180deg, #f8fbff 0%, #f2f7ff 100%)',
        border: '1px solid #dbe7ff', borderRadius: 12, flexShrink: 0
      }}>
        <textarea
          style={{
            flex: 1, padding: '9px 11px',
            border: '1px solid #cfdcff', borderRadius: 10,
            fontSize: fontSize, background: '#fff', color: '#1f2937',
            outline: 'none', minHeight: 38, maxHeight: 88,
            resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit'
          }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={selectedParcel ? '询问关于该地块的问题...' : '请先在地图选中地块'}
          disabled={!selectedParcel}
        />
        <button
          onClick={sendMessage}
          disabled={!selectedParcel}
          style={{
            minWidth: 60, padding: '9px 12px',
            border: 'none', borderRadius: 10, fontSize: fontSize, fontWeight: 600,
            color: '#fff',
            background: selectedParcel ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : '#a5b4c9',
            cursor: selectedParcel ? 'pointer' : 'not-allowed',
            boxShadow: selectedParcel ? '0 4px 12px rgba(37,99,235,0.25)' : 'none',
            flexShrink: 0
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
};

export default ChatBox;