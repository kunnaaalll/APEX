import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'

export function useSSE() {
  const { 
    setAccount, setPerformance, updateMarketData, 
    updateConfluence, addLog, addCouncil, 
    setTrades, setCalendar, clearTrades,
    setIntelligence, addChatMessage, setRiskStatus
  } = useStore()

  // ⚡ PERFORMANCE THROTTLE: Buffering data to prevent React 'Render Storms'
  const buffer = useRef({ market: {}, confluence: {} });
  const timer = useRef(null);

  useEffect(() => {
    const es = new EventSource('/events')
    
    es.onopen = () => addLog({ message: 'Aria V15.0: The Obsidian Monolith Neural Link Active.', type: 'success' })
    es.onerror = () => addLog({ message: 'Neural Pulse recalibrating...', type: 'warn' })

    // 🚀 High-Frequency Throttled Events
    es.addEventListener('market_data', (e) => {
      const data = JSON.parse(e.data);
      buffer.current.market[data.symbol] = data;
    });

    es.addEventListener('confluence', (e) => {
      const data = JSON.parse(e.data);
      buffer.current.confluence[data.symbol] = data;
    });

    // 💰 Institutional Account Pulse
    es.addEventListener('account', (e) => setAccount(JSON.parse(e.data)))
    es.addEventListener('stats', (e) => setAccount(JSON.parse(e.data)))
    
    // 🛡️ Risk Telemetry Pulse (V15 Live Config)
    es.addEventListener('risk_status', (e) => setRiskStatus(JSON.parse(e.data)))
    
    // 📊 Performance & Council
    es.addEventListener('performance', (e) => setPerformance(JSON.parse(e.data)))
    es.addEventListener('council', (e) => addCouncil(JSON.parse(e.data)))
    es.addEventListener('log', (e) => {
      const log = JSON.parse(e.data);
      if (!log.message?.includes('Data:')) addLog(log);
    })
    
    // 🧠 Deep Intelligence & Command
    es.addEventListener('intelligence', (e) => setIntelligence(JSON.parse(e.data)))
    
    // 🗣️ Sovereign Command: Listen for AI responses
    es.addEventListener('chat_response', (e) => {
      const response = JSON.parse(e.data);
      addChatMessage(response);
    })
    
    es.addEventListener('clear_trades', () => clearTrades())
    es.addEventListener('trade', (e) => {
      const trade = JSON.parse(e.data);
      setTrades((prev) => [...prev, trade]);
    })
    es.addEventListener('calendar', (e) => setCalendar(JSON.parse(e.data)))

    // 🔄 THE PULSE: Every 300ms, flush the high-frequency buffer to the state
    timer.current = setInterval(() => {
      // Flush Market Data (Price + History)
      const markets = Object.values(buffer.current.market);
      if (markets.length > 0) {
        markets.forEach(data => updateMarketData(data));
        buffer.current.market = {};
      }

      // Flush Confluence Data
      const confluences = Object.values(buffer.current.confluence);
      if (confluences.length > 0) {
        confluences.forEach(data => updateConfluence(data));
        buffer.current.confluence = {};
      }
    }, 300);

    return () => {
      es.close();
      if (timer.current) clearInterval(timer.current);
    }
  }, [])
}
