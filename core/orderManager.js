const server = require('./server');
const journal = require('../db/journal');
const dashboard = require('../web/webDashboard');
const telegram = require('../notify/telegram');

class OrderManager {
    constructor() {
        this.openTrades = [];
        this.riskPercent = parseFloat(process.env.DEFAULT_RISK_PERCENT) || 1;
    }

    async executeSetup(symbol, decision) {
        dashboard.logMessage(`Council verdict: ${decision.direction} for ${symbol}. Executing...`);
        
        const order = {
            symbol: symbol,
            type: this.determineOrderType(decision),
            direction: decision.direction,
            entry: decision.entry,
            sl: decision.sl,
            tp: decision.tp,
            volume: 0.01
        };

        // 1. Log to Journal
        const tradeId = await journal.logTrade(order);
        dashboard.logMessage(`Trade ${tradeId} logged to database.`);

        // 2. Submit to Gateway
        server.addOrder(order);

        // 3. Update Dashboard & Telegram
        const openTrades = await journal.getOpenTrades();
        dashboard.updateTrades(openTrades);
        telegram.notifySetup(symbol, decision);
    }

    determineOrderType(decision) {
        if (decision.type) return decision.type;
        return 'MARKET';
    }

    calculateLotSize(balance, riskPercent, slPips) {
        return 0.1;
    }

    updateTrades(tradeInfo) {
        // Management logic here (Move SL to BE, Trailing, etc.)
    }
}

module.exports = new OrderManager();
