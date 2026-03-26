const fs = require('fs');
const path = require('path');
const dashboard = require('../web/webDashboard');

class OrderManager {
    constructor() {
        this.ledgerPath = path.join(__dirname, '../db/journal.json');
        this.initLedger();
    }

    initLedger() {
        if (!fs.existsSync(path.dirname(this.ledgerPath))) {
            fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
        }
        if (!fs.existsSync(this.ledgerPath)) {
            fs.writeFileSync(this.ledgerPath, JSON.stringify({ trades: [] }, null, 2));
        }
    }

    executeSetup(setup, server) {
        dashboard.logMessage(`EXECUTING: ${setup.symbol} ${setup.direction} @ ${setup.entry}`, 'info');
        
        // 🛠️ Ensure direction and prices are clearly mapped for the Bridge
        const command = {
            symbol: setup.symbol,
            type: 'MARKET',
            direction: setup.direction,
            volume: 0.1, // Default lot size
            sl: setup.sl || 0,
            tp: setup.tp || 0
        };

        server.pendingOrders.push(command);
        
        // Save to journal
        this.recordTrade(setup);
    }

    recordTrade(trade) {
        try {
            const data = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
            trade.timestamp = new Date().toISOString();
            data.trades.push(trade);
            fs.writeFileSync(this.ledgerPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Ledger Error:', e);
        }
    }
}

module.exports = new OrderManager();
