// src/components/TimelineSlider.jsx
import React from 'react';

const TimelineSlider = ({ year, setYear, isPlaying, setIsPlaying }) => {
  const years = [2018, 2019, 2020, 2021, 2022];

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSliderChange = (e) => {
    setYear(parseInt(e.target.value, 10));
    setIsPlaying(false); // 拖动时暂停播放
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '60%',
      maxWidth: '800px',
      background: 'rgba(255, 255, 255, 0.9)',
      padding: '12px 16px',
      borderRadius: '14px',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.2)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      zIndex: 1000
    }}>
      <button onClick={handlePlayPause} style={{
        width: '38px',
        height: '38px',
        borderRadius: '50%',
        border: 'none',
        fontSize: '16px',
        color: '#fff',
        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
        boxShadow: '0 6px 14px rgba(29, 78, 216, 0.3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <input 
            type="range" 
            min="2018" 
            max="2022" 
            step="1" 
            value={year}
            onChange={handleSliderChange}
            style={{
              width: '100%',
              accentColor: '#2563eb',
              cursor: 'pointer'
            }}
          />
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginTop: '2px', padding: '0 2px', boxSizing: 'border-box' }}>
            {years.map(y => (
              <span
                key={y}
                onClick={() => { setYear(y); setIsPlaying(false); }}
                style={{
                  fontSize: '12px',
                  fontWeight: y === year ? 700 : 400,
                  color: y === year ? '#1d4ed8' : '#64748b',
                  cursor: 'pointer',
                  userSelect: 'none',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  background: y === year ? 'rgba(37,99,235,0.1)' : 'transparent',
                  transition: 'all 0.15s ease'
                }}
              >
                {y}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>{year}</div>
    </div>
  );
};

export default TimelineSlider;
