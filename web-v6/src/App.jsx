import React, { useState, useEffect, useMemo, memo, useRef } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { 
  Home, Globe, MessageSquare, Search, 
  ChevronDown, ChevronRight, Plus, MoreHorizontal,
  TrendingUp, Zap, Activity, Brain, LayoutGrid, Cpu, 
  Fingerprint, Compass, AlertCircle, Award, Settings2, Send, X,
  Wallet, PieChart, Landmark, TrendingDown, Clock, Shield, BarChart2,
  Lock, Settings, RefreshCw, AlertTriangle, Power, Target, Filter
} from 'lucide-react'
import useStore from './store/useStore'
import { useSSE } from './hooks/useSSE'

// 🌌 OBSIDIAN UTILS 🌌
const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

// 📈 LUMINESCENT SPARKLINE COMPONENT 📈
const Sparkline = memo(({ data, color = "#FF4B91" }) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((d, i) => ({
    x: (i / (data.length - 1)) * 100,
    y: 100 - ((d - min) / range) * 100
  }));

  const path = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;

  return (
    <svg viewBox="0 0 100 100" className="w-full h-10 overflow-visible">
      <motion.path
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        d={path}
        fill="transparent"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="drop-shadow-[0_0_8px_var(--spark-color)]"
        style={{ '--spark-color': color }}
      />
    </svg>
  );
});

// 🎯 STRIKE CONTROL PANEL (ARIA V15.2 PATCH) 🎯
const StrikeControlPanel = memo(() => {
  const { showStrikePanel, toggleStrikePanel, symbols, riskStatus } = useStore();
  const [selectedSym, setSelectedSym] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStrike = async (dir) => {
    if (!selectedSym || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/strike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSym, direction: dir })
      });
      if (res.ok) toggleStrikePanel();
      else {
        const data = await res.json();
        alert(`Strike Rejected: ${data.reason}`);
      }
    } catch (e) {
      alert("Neural Link timeout. Signal lost.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {showStrikePanel && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[250]" onClick={() => toggleStrikePanel()} />
          <motion.aside initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="fixed inset-x-0 bottom-0 bg-[#0A0A0C] border-t border-white/10 z-[260] p-10 flex flex-col items-center space-y-10 shadow-2xl rounded-t-[3rem] max-w-5xl mx-auto">
             <div className="w-20 h-1.5 bg-white/10 rounded-full mb-4" />
             <header className="text-center space-y-2">
                <h2 className="text-4xl font-black text-white tracking-widest uppercase">Tactical Strike Pulse</h2>
                <p className="text-xs font-black text-pink-500/60 tracking-widest uppercase">Manual Engagement Override v15.2</p>
             </header>

             <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-10">
                <section className="space-y-6">
                   <h3 className="text-[10px] font-black text-white/40 tracking-widest uppercase">1. Select Instrument</h3>
                   <div className="grid grid-cols-2 gap-3">
                      {Object.keys(symbols).map(sym => (
                        <button key={sym} onClick={() => setSelectedSym(sym)} className={`p-4 rounded-xl border font-black text-sm transition-all ${selectedSym === sym ? 'bg-pink-500 border-pink-500 text-white shadow-2xl shadow-pink-500/40' : 'bg-white/5 border-white/5 text-white/40 hover:border-white/20'}`}>{sym}</button>
                      ))}
                   </div>
                </section>

                <section className="space-y-6">
                   <h3 className="text-[10px] font-black text-white/40 tracking-widest uppercase">2. Risk Impact Audit</h3>
                   <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <ImpactRow label="Lot Sizing" value="Auto-Calibrated" />
                      <ImpactRow label="Risk Value" value={`${riskStatus.riskPercent || 1.0}% Equity`} color="text-pink-400" />
                      <ImpactRow label="Engagement" value="Instant Strike" />
                   </div>
                </section>
             </div>

             <div className="flex gap-6 w-full max-w-2xl">
                <button onClick={() => handleStrike('BUY')} disabled={!selectedSym || loading} className="flex-1 py-6 rounded-2xl bg-emerald-500 text-black font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-emerald-500/20 flex items-center justify-center gap-3 disabled:opacity-20 disabled:grayscale">
                   <TrendingUp className="w-6 h-6" /> Strike BUY
                </button>
                <button onClick={() => handleStrike('SELL')} disabled={!selectedSym || loading} className="flex-1 py-6 rounded-2xl bg-red-500 text-white font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-red-500/20 flex items-center justify-center gap-3 disabled:opacity-20 disabled:grayscale">
                   <TrendingDown className="w-6 h-6" /> Strike SELL
                </button>
             </div>
             <button onClick={() => toggleStrikePanel()} className="text-[10px] font-black text-white/20 uppercase tracking-widest hover:text-white transition-colors">Deactivate Pulse Link</button>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
})

const ImpactRow = ({ label, value, color = "text-white" }) => (
  <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest">
     <span className="text-white/20">{label}</span>
     <span className={color}>{value}</span>
  </div>
)

// 🛡️ RISK CONTROL HUB 🛡️
const RiskControlHub = memo(() => {
  const { riskStatus, toggleRiskHub, showRiskHub } = useStore();
  const [localRisk, setLocalRisk] = useState(riskStatus.riskPercent || 1);
  const [localTrades, setLocalTrades] = useState(riskStatus.maxOpenTrades || 3);

  const handleUpdate = async () => {
     try {
       await fetch('/config', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ riskPercent: localRisk, maxSimultaneousTrades: localTrades })
       });
       toggleRiskHub();
     } catch (e) {}
  };

  return (
    <AnimatePresence>
      {showRiskHub && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200]" onClick={toggleRiskHub} />
          <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed inset-y-0 right-0 w-full lg:w-[450px] bg-[#0A0A0C] border-l border-white/5 z-[210] p-10 flex flex-col space-y-10 shadow-2xl">
            <header className="flex justify-between items-center">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-red-500/10 text-red-500 rounded-xl"><Shield className="w-6 h-6" /></div>
                  <div>
                    <h2 className="text-2xl font-black text-white tracking-tighter">Risk Engine</h2>
                    <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Institutional Guard v15.2</span>
                  </div>
               </div>
               <button onClick={toggleRiskHub} className="p-3 rounded-xl hover:bg-white/5 transition-colors"><X className="w-6 h-6 text-white/40" /></button>
            </header>

            <div className="flex-1 space-y-12 py-10 overflow-y-auto custom-scroll">
               <section className="space-y-6">
                  <div className="flex justify-between items-center"><span className="text-xs font-black text-white tracking-widest uppercase">Risk Per Strike</span><span className="text-lg font-black text-pink-500">{localRisk}%</span></div>
                  <input type="range" min="0.1" max="5.0" step="0.1" value={localRisk} onChange={(e) => setLocalRisk(e.target.value)} className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-pink-500" />
               </section>

               <section className="space-y-6">
                  <div className="flex justify-between items-center"><span className="text-xs font-black text-white tracking-widest uppercase">Max Engagement Capacity</span><span className="text-lg font-black text-white">{localTrades} Slots</span></div>
                  <input type="range" min="1" max="10" step="1" value={localTrades} onChange={(e) => setLocalTrades(e.target.value)} className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-white" />
               </section>
            </div>

            <footer className="space-y-4">
               <button onClick={handleUpdate} className="w-full py-6 rounded-[2rem] bg-white text-black font-black text-lg hover:bg-pink-500 hover:text-white transition-all flex items-center justify-center gap-3">
                  <RefreshCw className="w-5 h-5" /> Push to Neural Bridge
               </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
})

// 📈 NEURAL PULSE TICKER 📈
const PulseTicker = memo(() => {
  const { logs } = useStore();
  const displayLogs = logs.slice(0, 5).reverse();

  return (
    <footer className="fixed bottom-0 left-0 right-0 h-10 bg-black/80 backdrop-blur-xl border-t border-white/5 flex items-center overflow-hidden z-[100]">
       <div className="px-6 h-full flex items-center bg-pink-500 text-black font-black text-[10px] uppercase tracking-widest shrink-0 shadow-[0_0_15px_rgba(236,72,153,0.3)]">Neural Pulse</div>
       <div className="flex gap-10 px-10 animate-marquee whitespace-nowrap items-center">
          {displayLogs.map((l, i) => (
            <div key={i} className="flex items-center gap-3">
               <div className={`w-1 h-1 rounded-full ${l.type === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : l.type === 'warn' ? 'bg-amber-500' : l.type === 'error' ? 'bg-red-500' : 'bg-white/20'}`} />
               <span className="text-[10px] font-black text-white/40 uppercase tracking-widest italic">{l.message}</span>
            </div>
          ))}
          {displayLogs.map((l, i) => (
            <div key={i + 'dup'} className="flex items-center gap-3">
               <div className={`w-1 h-1 rounded-full ${l.type === 'success' ? 'bg-emerald-500' : l.type === 'warn' ? 'bg-amber-500' : l.type === 'error' ? 'bg-red-500' : 'bg-white/20'}`} />
               <span className="text-[10px] font-black text-white/40 uppercase tracking-widest italic">{l.message}</span>
            </div>
          ))}
       </div>
    </footer>
  )
})

// ⚡ ACCOUNT HUD (ARIA V15.2 PATCHED) ⚡
const AccountHUD = memo(() => {
  const { equity, margin, profit, toggleRiskHub, riskStatus } = useStore();
  const isProfit = profit >= 0;

  return (
    <motion.div layout className="flex gap-2 items-center">
       <div className="px-3 py-1.5 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center gap-2 group cursor-help transition-all hover:bg-pink-500/20" title="Goat Funded Trader Safety Protocol Active">
          <Shield className="w-3.5 h-3.5 text-pink-500" />
          <span className="text-[9px] font-black text-pink-500 uppercase tracking-widest leading-none">GFT Compliance</span>
       </div>
       <HudTile label="Equity" value={formatCurrency(equity)} color="text-pink-400" />
       <HudTile label="Margin" value={formatCurrency(margin)} color="text-amber-400" />
       <HudTile label="Risk Bias" value={`${riskStatus.riskPercent || 1.0}%`} color="text-white/60" />
       <div className={`px-4 py-1.5 rounded-lg border flex items-center gap-3 transition-colors ${isProfit ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
          <span className={`text-base font-black tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
             {isProfit ? '+' : ''}{formatCurrency(profit)}
          </span>
          <Activity className={`w-4 h-4 ${isProfit ? 'text-emerald-400' : 'text-red-400'} animate-pulse`} />
       </div>
       <button onClick={toggleRiskHub} className="p-2 rounded-lg bg-white/5 border border-white/5 text-white/40 hover:text-white transition-all"><Settings className="w-4 h-4" /></button>
    </motion.div>
  )
})

const HudTile = ({ label, value, color }) => (
  <div className="px-4 py-1.5 rounded-lg bg-white/5 border border-white/5 flex flex-col min-w-[90px]">
     <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">{label}</span>
     <span className={`text-xs font-black tracking-tighter ${color}`}>{value}</span>
  </div>
)

// ⚡ LIQUID SIDEBAR ⚡
const Sidebar = memo(() => {
  const { activeTab, setActiveTab } = useStore();
  return (
    <aside className="w-20 lg:w-24 lumina-sidebar shrink-0 z-[100] fixed inset-y-0 left-0 lg:relative">
      <div className="w-10 h-10 lg:w-12 lg:h-12 bg-gradient-to-tr from-pink-500 to-purple-600 rounded-xl lg:rounded-2xl flex items-center justify-center shadow-2xl cursor-pointer relative group">
        <Zap className="text-white w-5 lg:w-6 h-5 lg:h-6 fill-current group-hover:scale-125 transition-transform" />
      </div>
      <nav className="flex flex-col gap-8 lg:gap-10 mt-12 relative flex-1">
        <SideIcon Icon={Home} id="dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
        <SideIcon Icon={MessageSquare} id="chat" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        <SideIcon Icon={Brain} id="intelligence" active={activeTab === 'intelligence'} onClick={() => setActiveTab('intelligence')} />
      </nav>
      <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 shadow-2xl cursor-pointer mb-6">
        <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Aria" alt="Admin" />
      </div>
    </aside>
  )
})

const SideIcon = ({ Icon, id, active, onClick }) => (
  <div onClick={onClick} className="relative group cursor-pointer p-4 flex justify-center">
    {active && <motion.div layoutId="nav-glow" className="absolute inset-0 bg-pink-500/10 rounded-2xl border border-pink-500/20 blur-sm" />}
    <Icon className={`w-5 lg:w-6 h-5 lg:h-6 transition-all duration-500 ${active ? 'text-pink-500 scale-110' : 'text-white/20 group-hover:text-white'}`} />
    {active && <motion.div layoutId="nav-indicator" className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-pink-500 rounded-full" />}
  </div>
)

// 🗣️ TACTICAL COMMAND TERMINAL (ARIA V15.2 ROBUST CHAT) 🗣️
const TacticalChat = memo(() => {
  const { chatHistory, isChatLoading, addChatMessage, setChatLoading, symbols } = useStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [chatHistory]);

  const handleSend = async (forcedText) => {
    const msg = (forcedText || input).trim();
    if (!msg || isChatLoading) return;
    
    setInput('');
    addChatMessage({ message: msg, type: 'user' });
    setChatLoading(true);

    try {
      const res = await fetch('/chat', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ message: msg, context: { symbols } }) 
      });
      
      const rawBody = await res.text();
      let data = {};
      try {
        data = JSON.parse(rawBody);
      } catch (parseErr) {
        throw new Error(`Malformed signal pulse: ${rawBody.substring(0, 50)}...`);
      }

      if (!res.ok) {
        throw new Error(data.reason || `Link Error ${res.status}: ${rawBody.substring(0, 30)}`);
      }
      // AI response is broadcast via SSE and intercepted by useSSE hook
    } catch (e) {
      console.error('Tactical Chat Error:', e);
      addChatMessage({ message: `Sovereign Neural Link disrupted: ${e.message}`, type: 'error' });
    } finally { 
      setChatLoading(false); 
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 bg-[#0A0A0C] overflow-hidden">
       <div className="flex-1 flex flex-col relative border-r border-white/5">
          <header className="p-8 border-b border-white/5 flex justify-between items-center bg-black/20 backdrop-blur-xl">
             <div className="flex items-center gap-4">
                <div className="p-2 bg-pink-500/10 text-pink-500 rounded-lg shadow-[0_0_15px_rgba(236,72,153,0.2)]"><MessageSquare className="w-5 h-5" /></div>
                <h1 className="text-xl font-black text-white tracking-widest uppercase">Tactical Link</h1>
             </div>
             <div className="flex items-center gap-4 text-[10px] uppercase font-black tracking-widest text-white/30">
                <span className="text-emerald-500 animate-pulse">Node: Active</span>
                <div className="w-px h-4 bg-white/5" />
                <span>v15.2 Patch</span>
             </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 custom-scroll space-y-6">
             {chatHistory.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`max-w-[75%] p-5 rounded-2xl text-sm leading-relaxed border transition-all ${
                     m.type === 'user' ? 'bg-white/10 text-white border-white/10' : 
                     m.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20 font-black' :
                     'bg-[#121417] text-white/70 border-white/5 shadow-xl'
                   }`}>
                      {m.message}
                   </div>
                </motion.div>
             ))}
             {isChatLoading && <TypingIndicator />}
          </div>

          <div className="p-8 bg-black/40 backdrop-blur-3xl border-t border-white/5">
             <div className="max-w-4xl mx-auto space-y-4">
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                   <MetaChip label="Deep Scan" onClick={() => handleSend("Run internal deep scan on all instruments.")} />
                   <MetaChip label="Risk Audit" onClick={() => handleSend("Current risk profile status and drawdown audit.")} />
                   <MetaChip label="Neural Consensus" onClick={() => handleSend("Neural council consensus on gold.")} />
                </div>
                <div className="relative">
                   <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} placeholder="Issue Sovereign Command..." className="w-full pl-6 pr-16 py-4 bg-[#121417] border border-white/5 rounded-2xl text-white focus:outline-none focus:border-pink-500/30 transition-all text-sm font-bold h-16 resize-none" />
                   <button onClick={() => handleSend()} className="absolute right-3 bottom-3 p-3 bg-pink-500 text-white rounded-xl shadow-2xl shadow-pink-500/30 hover:scale-110 active:scale-95 transition-all">
                      <Send className="w-4 h-4" />
                   </button>
                </div>
             </div>
          </div>
       </div>
    </motion.div>
  )
})

const MetaChip = ({ label, onClick }) => (
  <button onClick={onClick} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-pink-500/10 hover:text-pink-500 transition-all whitespace-nowrap">{label}</button>
)

const TypingIndicator = () => (
  <div className="flex justify-start"><div className="p-4 bg-white/5 rounded-2xl flex gap-1.5"><div className="w-1 h-1 bg-pink-500/40 rounded-full animate-bounce" /><div className="w-1 h-1 bg-pink-500/40 rounded-full animate-bounce [animation-delay:0.2s]" /><div className="w-1 h-1 bg-pink-500/40 rounded-full animate-bounce [animation-delay:0.4s]" /></div></div>
)

// 📊 MAIN DASHBOARD 📊
const Dashboard = memo(() => {
  const { symbols, trades, council, setSelectedSymbol, toggleStrikePanel } = useStore();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 lg:p-10 space-y-8 h-screen overflow-y-auto custom-scroll pb-32">
       <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 flex-1">
             <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black tracking-tighter text-white uppercase">Monolith Protocol</h1>
                <div className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[8px] font-black uppercase border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]">Active Matrix</div>
             </div>
             <AccountHUD />
          </div>
          <button onClick={() => toggleStrikePanel()} className="p-4 rounded-xl bg-white text-black font-black text-xs shadow-2xl hover:bg-pink-500 hover:text-white transition-all flex items-center gap-3">
             <Plus className="w-4 h-4" /> Tactical Strike Execution
          </button>
       </header>

       <div className="grid grid-cols-1 2xl:grid-cols-[1fr_360px] gap-8">
          <div className="space-y-8">
             {/* NEURAL MONITORING GRID */}
             <section className="space-y-4">
                <div className="flex justify-between items-end">
                   <h3 className="text-[10px] font-black text-white/40 tracking-widest uppercase flex items-center gap-3"><Globe className="w-4 h-4 text-pink-500" /> Neural Monitoring Grid</h3>
                   <span className="text-[8px] font-black text-white/10 uppercase tracking-widest">Active Pair Streams</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                   {Object.entries(symbols).map(([sym, s]) => <SymbolTile key={sym} sym={sym} s={s} onClick={() => setSelectedSymbol(sym)} />)}
                   {Object.keys(symbols).length === 0 && <EmptySymbols />}
                </div>
             </section>

             {/* DATA CHANNELS */}
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="lumina-card p-6 space-y-6 bg-white/5 border-white/5">
                   <h3 className="text-[10px] font-black text-white/30 tracking-widest uppercase flex items-center gap-3"><Activity className="w-4 h-4 text-emerald-500" /> Operational Stream</h3>
                   <div className="space-y-3">
                      {trades.map((t, i) => <OrderRow key={t.ticket || i} t={t} onClick={() => setSelectedSymbol(t.symbol)} />)}
                      {trades.length === 0 && <EmptyPlaceholder text="Waiting for trade engagement..." />}
                   </div>
                </div>

                <div className="lumina-card p-6 space-y-6 bg-pink-500/5 border-pink-500/10">
                   <h3 className="text-[10px] font-black text-pink-500 tracking-widest uppercase flex items-center gap-3"><Brain className="w-4 h-4" /> Council Consensus</h3>
                   <div className="space-y-3">
                      {council.slice(0, 5).map((d, i) => (
                        <div key={i} className="p-4 bg-black/40 rounded-2xl border border-white/5 hover:border-pink-500/30 transition-all cursor-pointer" onClick={() => setSelectedSymbol(d.symbol)}>
                           <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-black text-white">{d.symbol}</span>
                              <span className="text-[8px] font-black text-pink-400 uppercase">{d.confidence}% Prob</span>
                           </div>
                           <p className="text-[10px] font-medium text-white/30 truncate italic">"{d.rationale}"</p>
                        </div>
                      ))}
                      {council.length === 0 && <EmptyPlaceholder text="Neural calibration in progress..." />}
                   </div>
                </div>
             </div>
          </div>

          <aside className="space-y-8 hidden 2xl:block">
             <section className="lumina-card p-6 space-y-6 bg-white/5 border-white/10">
                <h3 className="text-[10px] font-black text-white/30 tracking-widest uppercase flex items-center gap-2"><Target className="w-4 h-4 text-pink-500" /> Strike Analytics</h3>
                <div className="space-y-4">
                   <TelemetryMeter label="Neural Engine Load" percent={42} />
                   <TelemetryMeter label="Execution Quality" percent={98} color="text-emerald-500" />
                   <TelemetryMeter label="Signal Fidelity" percent={78} />
                </div>
             </section>
             <div className="p-6 rounded-2xl border border-white/5 space-y-3 bg-black/20">
                <StatusLed label="Neural REST Link" active />
                <StatusLed label="Risk Guard" active />
                <StatusLed label="AI Council" active />
             </div>
          </aside>
       </div>
    </motion.div>
  )
})

const SymbolTile = ({ sym, s, onClick }) => (
  <div onClick={onClick} className="lumina-card p-4 flex flex-col gap-3 group hover:scale-[1.02] border border-white/5 cursor-pointer relative overflow-hidden bg-gradient-to-br from-white/5 to-transparent">
     <div className="flex justify-between items-start">
        <div className="text-[10px] font-black tracking-widest text-white/30 uppercase group-hover:text-pink-500 transition-colors">{sym}</div>
        <div className="text-right">
           <div className="text-[11px] font-black text-white">{s.price?.toFixed(2)}</div>
           <div className={`text-[8px] font-black uppercase ${s.trend === 'BULLISH' ? 'text-emerald-400' : s.trend === 'BEARISH' ? 'text-red-400' : 'text-white/20'}`}>{s.trend || 'Wait'}</div>
        </div>
     </div>
     <Sparkline data={s.history || []} color={(s.confluence || 0) > 7 ? "#00FF87" : (s.confluence || 0) > 4 ? "#FF4B91" : "#ffffff"} />
     <div className="flex justify-between items-center mt-1">
        <div className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] font-black text-white/40 tracking-widest">CONF: {s.confluence?.toFixed(1) || '0.0'}</div>
        <Target className="w-3 h-3 text-white/10 group-hover:text-pink-500 transition-colors" />
     </div>
  </div>
)

const OrderRow = ({ t, onClick }) => {
  const isProfit = t.profit >= 0;
  return (
    <div onClick={onClick} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center gap-4 group hover:bg-white/10 transition-all cursor-pointer">
       <div className="w-9 h-9 rounded-lg bg-black flex items-center justify-center text-[10px] font-black text-white uppercase shrink-0">{t.symbol.substring(0,2)}</div>
       <div className="flex-1 min-w-0">
          <div className="text-xs font-black text-white truncate flex items-center gap-2">
             {t.symbol} 
             <span className={`text-[8px] px-1 py-0.5 rounded ${t.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{t.direction}</span>
          </div>
          <div className="text-[8px] font-black text-white/20 uppercase tracking-widest truncate">{t.volume} Lots | Entry: {t.entry}</div>
       </div>
       <div className={`text-xs font-black tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>{isProfit ? '+' : ''}{t.profit.toFixed(2)}</div>
    </div>
  )
}

const TelemetryMeter = ({ label, percent, color = "text-white" }) => (
  <div className="space-y-1.5">
    <div className="flex justify-between text-[8px] font-black uppercase tracking-widest"><span className="text-white/20">{label}</span><span className={color}>{percent}%</span></div>
    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
       <motion.div initial={{ width: 0 }} animate={{ width: `${percent}%` }} className={`h-full bg-current ${color}`} />
    </div>
  </div>
)

const StatusLed = ({ label, active }) => (
  <div className="flex justify-between items-center text-[9px] font-black text-white/40 uppercase tracking-widest">
    <span>{label}</span>
    <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-white/10'}`} />
  </div>
)

const EmptyPlaceholder = ({ text }) => (
  <div className="h-40 flex flex-col items-center justify-center opacity-10 space-y-2 py-10">
     <Activity className="w-6 h-6" />
     <span className="text-[8px] font-black uppercase tracking-widest">{text}</span>
  </div>
)

const EmptySymbols = () => (
   <div className="col-span-full py-10 text-center opacity-10 font-black text-[9px] uppercase tracking-widest">Syncing Neural Monitoring Grid...</div>
)

// 🎮 MAIN TERMINAL 🎮
const App = () => {
  useSSE();
  const { activeTab } = useStore();
  return (
    <div className="flex h-screen w-screen bg-[#0A0A0C] text-slate-300 overflow-hidden font-sans antialiased">
      <Sidebar />
      <main className="flex-1 overflow-hidden relative flex flex-col">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' ? <Dashboard key="dash" /> :
           activeTab === 'chat' ? <TacticalChat key="chat" /> :
           <IntelligenceHub key="intel" />}
        </AnimatePresence>
        <DetailPanelOverlay />
        <RiskControlHub />
        <StrikeControlPanel />
        <PulseTicker />
      </main>
    </div>
  )
}

const DetailPanelOverlay = () => {
  const { selectedSymbol, setSelectedSymbol } = useStore();
  return (
    <AnimatePresence>
      {selectedSymbol && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] flex justify-end">
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedSymbol(null)} />
           <DetailPanel onClose={() => setSelectedSymbol(null)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// RESTORING INTELLIGENCE HUB
const IntelligenceHub = memo(() => {
   const { weights, intelligence } = useStore();
   return (
     <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-8 lg:p-16 space-y-12 h-screen overflow-y-auto custom-scroll pb-40">
        <header className="space-y-4 text-center lg:text-left">
           <h1 className="text-4xl lg:text-7xl font-black tracking-tighter text-white uppercase italic">Neural Matrix</h1>
           <div className="flex items-center gap-3 justify-center lg:justify-start">
              <p className="text-[10px] font-black text-pink-500 uppercase tracking-[0.5em]">Weight Calibration v15.2</p>
           </div>
        </header>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
           <section className="lumina-card p-8 space-y-10 bg-white/5 border-white/5">
              <h3 className="text-xs font-black text-white/40 tracking-widest uppercase flex items-center gap-3"><Settings2 className="w-5 h-5 text-pink-500" /> Learning Pulse</h3>
              <div className="grid grid-cols-1 gap-8">
                 {Object.entries(weights).map(([key, val]) => (
                   <div key={key} className="space-y-4">
                      <div className="flex justify-between text-[10px] font-black uppercase">
                         <span className="text-white/30">{key.replace(/([A-Z])/g, ' $1')}</span>
                         <span className="text-pink-400 font-mono tracking-widest">{val.toFixed(2)}x</span>
                      </div>
                      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                         <motion.div initial={{ width: 0 }} animate={{ width: `${(val / 2) * 100}%` }} className="h-full bg-pink-500 shadow-[0_0_12px_rgba(236,72,153,0.5)]" />
                      </div>
                   </div>
                 ))}
              </div>
           </section>
           <div className="lumina-card p-10 bg-emerald-500/5 border-emerald-500/10 space-y-8">
              <h3 className="text-xs font-black text-emerald-500 tracking-widest uppercase flex items-center gap-3"><Activity className="w-4 h-4" /> Learned Insights</h3>
              <div className="space-y-6">
                 {intelligence.rules?.slice(0, 4).map((rule, i) => (
                    <div key={i} className="flex gap-4">
                       <div className="w-1 h-1 rounded-full bg-emerald-500 mt-2 shrink-0" />
                       <p className="text-xs font-medium text-white/50 leading-relaxed italic">"{rule}"</p>
                    </div>
                 ))}
              </div>
           </div>
        </div>
     </motion.div>
   )
})

const DetailPanel = memo(({ onClose }) => {
   const { selectedSymbol, symbols, council, toggleStrikePanel } = useStore();
   const s = symbols[selectedSymbol] || {};
   const decision = council.find(c => c.symbol === selectedSymbol) || {};
   if (!selectedSymbol) return null;

   return (
     <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="relative w-full lg:w-[460px] h-full bg-[#0A0A0C] border-l border-white/5 p-10 flex flex-col space-y-10 shadow-2xl overflow-y-auto no-scrollbar">
        <header className="flex justify-between items-center">
           <div className="flex items-center gap-5">
              <div className="w-12 h-12 rounded-xl bg-white text-black font-black text-xl flex items-center justify-center uppercase">{selectedSymbol.substring(0,2)}</div>
              <div>
                 <h2 className="text-2xl font-black text-white tracking-widest uppercase">{selectedSymbol}</h2>
                 <span className="text-[8px] font-black text-pink-500 uppercase tracking-widest">Neural Audit Protocol</span>
              </div>
           </div>
           <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 transition-colors"><X className="w-6 h-6 text-white/40" /></button>
        </header>

        <section className="space-y-4">
           <h3 className="text-[10px] font-black text-white/30 tracking-widest uppercase px-2">Council Verdict</h3>
           <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-4">
              <div className="flex justify-between items-center">
                 <span className={`px-2 py-0.5 rounded text-[8px] font-black tracking-widest uppercase ${decision.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>{decision.direction || 'WAITING'}</span>
                 <span className="text-xs font-black text-pink-500 font-mono">{decision.confidence || 0}% PROB</span>
              </div>
              <p className="text-[11px] font-medium text-white/50 leading-relaxed italic">"{decision.rationale || 'Calculating SMC confluence depth...'}"</p>
           </div>
        </section>

        <section className="space-y-4">
           <h3 className="text-[10px] font-black text-white/30 tracking-widest uppercase px-2">Neural Data Matrix</h3>
           <div className="grid grid-cols-2 gap-3">
              <DXBox label="Trend Bias" value={s.trend || 'Neut'} color="text-pink-400" />
              <DXBox label="Confluence" value={s.confluence?.toFixed(1) || '0.0'} color="text-emerald-400" />
              <DXBox label="RSI Pulse" value={s.rsi?.toFixed(0) || '50'} color="text-white" />
              <DXBox label="Neural ATR" value={s.atr?.toFixed(5) || '0.00'} color="text-white/40" />
           </div>
        </section>

        <div className="flex-1" />

        <button onClick={() => toggleStrikePanel({ symbol: selectedSymbol, direction: '' })} className="w-full py-5 rounded-2xl bg-white text-black font-black text-sm uppercase tracking-widest hover:bg-pink-500 hover:text-white transition-all shadow-2xl flex items-center justify-center gap-3">
           <Zap className="w-5 h-5 fill-current" /> Initialize Strike
        </button>
     </motion.aside>
   )
})

const DXBox = ({ label, value, color }) => (
  <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-1 min-w-0">
     <span className="text-[7px] font-black text-white/20 uppercase tracking-widest truncate">{label}</span>
     <span className={`text-xs font-black truncate ${color}`}>{value}</span>
  </div>
)

export default App
