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
                req.body = raw.length > 0 ? JSON.parse(raw) : {};
            } catch (e) { req.body = {}; }
            next();
        });
    }

    setupRoutes() {
        this.app.post('/update', (req, res, next) => this.parseBody(req, res, next), (req, res) => {
            const { symbol, timeframe, candles, account } = req.body || {};

            if (symbol) {
                this.emit('market_data', { symbol, timeframe, candles });
                this.emit('account_info', account);

                // Get current price from last candle
                const price = candles && candles.length > 0 ? candles[0].close : null;
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
