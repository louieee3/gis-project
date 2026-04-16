import './App.css'
import MapBoard from './components/MapBoard'
import AnalysisPanel from './components/AnalysisPanel'
import FloatingChat from './components/FloatingChat'
import ParcelAnalysisFloat from './components/ParcelAnalysisFloat'

function App() {
  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-title">
          <span className="app-title-icon">🌾</span>
          <span className="app-title-text">武汉耕地非农化变化检测系统</span>
          <span className="app-title-year">2018 – 2022</span>
        </div>
      </header>
      <div className="app-body">
        <div className="map-section">
          <MapBoard />
          <FloatingChat />
          <ParcelAnalysisFloat />
        </div>
        <div className="sidebar-section">
          <AnalysisPanel />
        </div>
      </div>
    </div>
  )
}

export default App