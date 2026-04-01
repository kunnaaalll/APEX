import { create } from 'zustand'

const useStore = create((set) => ({
  // Account Spectrum
  balance: 0,
  equity: 0,
  margin: 0,
  freeMargin: 0,
  profit: 0,
  marginLevel: 0,
  
  // Risk Central
  riskStatus: {
    dailyPnL: 0,
    dailyTradeCount: 0,
    consecutiveLosses: 0,
    openTradeCount: 0,
    maxOpenTrades: 3,
    riskPercent: 1.0,
    currentDrawdown: '0.00%',
    maxDrawdown: '15.0%',
    cooldownActive: false
  },

  // Performance Metrics
  sharpe: 0,
  winRate: 0,
  totalTrades: 0,
  drawdown: 0,
  
  // Market Data (Deep Matrix + Sparkline Buffers)
  symbols: {}, // { EURUSD: { price, confluence, history: [], h1, h4, d1, trend, zone, atr } }
  trades: [],
  logs: [],
  council: [], 
  calendar: [],
  
  // Sovereign Command (The Chat)
  chatHistory: [
    { message: "Sovereign Neural Link established. Ready for institutional command.", type: 'ai' }
  ],
  isChatLoading: false,

  // Deep Intelligence (The Brain)
  weights: {
    emaDifference: 1.0,
    rsiExtreme: 1.0,
    obPresence: 1.0,
    fvgPresence: 1.0,
    bosConfirm: 1.0,
    liquiditySweep: 1.0,
    premiumDiscount: 1.0,
    sessionWeight: 1.0,
    baseConfidence: 1.0
  },
  intelligence: {
    rules: [],
    doNotRules: [],
    symbols: {},
    totalLessons: 0
  },

  // Navigation & Detail State
  activeTab: 'dashboard', 
  selectedSymbol: null,
  selectedTrade: null,
  showRiskHub: false,
  showStrikePanel: false,
  strikeSelection: { symbol: '', direction: '' },
  
  // Account Actions
  setAccount: (data) => set({ 
    balance: data.balance || 0, 
    equity: data.equity || 0,
    margin: data.margin || 0,
    freeMargin: data.free_margin || data.freeMargin || 0,
    profit: data.profit || 0,
    marginLevel: data.margin_level || data.marginLevel || 0
  }),

  toggleStrikePanel: (selection = null) => set((state) => ({ 
    showStrikePanel: !state.showStrikePanel,
    strikeSelection: selection || state.strikeSelection
  })),

  setRiskStatus: (data) => set({ riskStatus: data }),
  toggleRiskHub: () => set((state) => ({ showRiskHub: !state.showRiskHub })),
  
  setPerformance: (data) => set({
    winRate: data.winRate || 0,
    totalTrades: data.totalTrades || 0,
    sharpe: data.sharpeRatio || 0,
    drawdown: data.drawdown || 0
  }),
  
  updateMarketData: (data) => set((state) => {
    const nextSymbols = { ...state.symbols };
    const sym = data.symbol;
    if (!nextSymbols[sym]) nextSymbols[sym] = { 
      price: 0, confluence: 0, history: [], h1: 'NEUT', h4: 'NEUT', d1: 'NEUT',
      trend: 'NEUTRAL', zone: 'EQ', atr: 0
    };
    
    // Sparkline Buffer (Keep last 30 points)
    if (data.price) {
      const history = [...nextSymbols[sym].history, data.price].slice(-30);
      nextSymbols[sym].history = history;
    }

    // Deep Merge Market Data
    Object.keys(data).forEach(key => {
      if (key !== 'symbol') nextSymbols[sym][key] = data[key];
    });
    
    return { symbols: nextSymbols };
  }),
  
  updateConfluence: (data) => set((state) => {
    const nextSymbols = { ...state.symbols };
    if (!nextSymbols[data.symbol]) nextSymbols[data.symbol] = { confluence: 0, history: [] };
    nextSymbols[data.symbol].confluence = data.score;
    return { symbols: nextSymbols };
  }),

  setIntelligence: (data) => set((state) => ({ 
    intelligence: data,
    weights: data.weights || { ...state.weights } 
  })),

  // Sovereign Command Actions
  addChatMessage: (msg) => set((state) => ({
    chatHistory: [...state.chatHistory, msg].slice(-50)
  })),
  setChatLoading: (loading) => set({ isChatLoading: loading }),
  
  addLog: (log) => set((state) => ({
    logs: [log, ...state.logs].slice(0, 200)
  })),
  
  addCouncil: (decision) => set((state) => ({
    council: [decision, ...state.council].slice(0, 50)
  })),
  
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedSymbol: (sym) => set({ selectedSymbol: sym, selectedTrade: null }),
  setSelectedTrade: (trade) => set({ selectedTrade: trade, selectedSymbol: null }),
  
  setTrades: (trades) => set({ trades }),
  setCalendar: (calendar) => set({ calendar }),
  clearTrades: () => set({ trades: [] })
}))

export default useStore
