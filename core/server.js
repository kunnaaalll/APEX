const express = require('express');
const events = require('events');
const webDashboard = require('../web/webDashboard');

class BridgeServer extends events.EventEmitter {
    constructor() {
        super();
        this.app = express();
        this.port = 3000;
        this.pendingOrders = [];

        // Dashboard routes first (no body parsing needed)
        webDashboard.attach(this.app);

        this.setupRoutes();
    }


    setupRoutes() {
        this.app.post('/update', express.raw({ limit: '50mb', type: '*/*' }), (req, res) => {
            // Parse raw body, stripping MQL5 null terminators
            let body = {};
            try {
                const raw = req.body.toString('utf8').replace(/\0/g, '').trim();
                body = JSON.parse(raw);
            } catch (e) {
                console.error(`[ERROR] JSON Parse: ${e.message}`);
                return res.status(400).json({ status: 'error', reason: 'Invalid JSON' });
            }

            const { symbol, timeframe, candles, account, positions, spread, ask, bid, calendar, candles_h1, candles_h4, candles_d1 } = body;
            
            // Handle MQL5 string quirks (null terminators)
            const cleanSymbol = (symbol && typeof symbol === 'string') ? symbol.replace(/\0/g, '').trim() : symbol;

            if (cleanSymbol) {
                console.log(`[DEBUG] /update: ${cleanSymbol} ${timeframe || ''} | Candles: ${candles ? candles.length : 0}`);
                
                this.emit('market_data', { 
                    symbol: cleanSymbol, timeframe, candles, positions, spread, ask, bid, 
                    candles_h1, candles_h4, candles_d1 
                });
                this.emit('account_info', account);

                // Forward calendar events
                if (calendar && calendar.length > 0) {
                    this.emit('calendar_data', calendar);
                }

                // Current price from LAST candle (chronological order: oldest→newest)
                const price = candles && candles.length > 0 ? candles[candles.length - 1].close : null;
                webDashboard.sendMarketData({ symbol: cleanSymbol, timeframe, price });
                if (account) webDashboard.sendAccountInfo(account);
            }

            const commands = this.pendingOrders.filter(o => o.symbol === symbol);
            this.pendingOrders = this.pendingOrders.filter(o => o.symbol !== symbol);
            res.json({ status: 'ok', commands });
        });

        this.app.get('/status', (req, res) => {
            res.json({ status: 'running', server: 'APEX Bridge' });
        });

        // 🚨 JSON Error Handler
        this.app.use((err, req, res, next) => {
            if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
                console.error(`[ERROR] JSON Parsing Failed: ${err.message}`);
                return res.status(400).json({ status: 'error', reason: 'Invalid JSON signature.' });
            }
            next();
        });
    }

    addOrder(order) { this.pendingOrders.push(order); }

    start() {
        this.app.listen(this.port, () => {
            console.log(`APEX: Server at http://localhost:${this.port}`);
        });
    }
}

module.exports = new BridgeServer();
