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

    parseBody(req, res, next) {
        let chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                let raw = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
                console.log('[DEBUG] Raw body length:', raw.length, 'First 200 chars:', raw.substring(0, 200));
                req.body = raw.length > 0 ? JSON.parse(raw) : {};
            } catch (e) {
                console.log('[DEBUG] JSON parse error:', e.message);
                req.body = {};
            }
            next();
        });
    }

    setupRoutes() {
        this.app.post('/update', (req, res, next) => this.parseBody(req, res, next), (req, res) => {
            const { symbol, timeframe, candles, account, positions, spread, ask, bid } = req.body || {};
            console.log('[DEBUG] /update hit - symbol:', symbol, 'timeframe:', timeframe, 'candles:', candles ? candles.length : 0);

            if (symbol) {
                this.emit('market_data', { symbol, timeframe, candles, positions, spread, ask, bid });
                this.emit('account_info', account);

                // Current price from LAST candle (chronological order: oldest→newest)
                const price = candles && candles.length > 0 ? candles[candles.length - 1].close : null;
                webDashboard.sendMarketData({ symbol, timeframe, price });
                if (account) webDashboard.sendAccountInfo(account);
            }

            const commands = this.pendingOrders.filter(o => o.symbol === symbol);
            this.pendingOrders = this.pendingOrders.filter(o => o.symbol !== symbol);
            res.json({ status: 'ok', commands });
        });

        this.app.get('/status', (req, res) => {
            res.json({ status: 'running', server: 'APEX Bridge' });
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
