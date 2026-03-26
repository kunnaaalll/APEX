const express = require('express');
const events = require('events');
const webDashboard = require('../web/webDashboard');

class BridgeServer extends events.EventEmitter {
    constructor() {
        super();
        this.app = express();
        // Custom parser: read raw bytes, strip null terminators, then JSON.parse
        this.app.use((req, res, next) => {
            let chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                try {
                    let raw = Buffer.concat(chunks).toString('utf8');
                    raw = raw.replace(/\0/g, '').trim();
                    req.body = raw.length > 0 ? JSON.parse(raw) : {};
                } catch (e) {
                    console.log('APEX: JSON parse warning, raw length:', Buffer.concat(chunks).length);
                    req.body = {};
                }
                next();
            });
        });
        this.port = 3000;
        this.pendingOrders = [];

        // Attach web dashboard routes
        webDashboard.attach(this.app);

        this.setupRoutes();
    }

    setupRoutes() {
        // MT5 posts market data here
        this.app.post('/update', (req, res) => {
            const { symbol, timeframe, candles, account } = req.body || {};

            if (symbol) {
                // Emit data for the watcher to handle
                this.emit('market_data', { symbol, timeframe, candles });
                this.emit('account_info', account);

                // Push to web dashboard
                webDashboard.sendMarketData({ symbol, timeframe });
                if (account) webDashboard.sendAccountInfo(account);
            }

            // Respond with any pending orders to be executed
            const commands = this.pendingOrders.filter(o => o.symbol === symbol);
            this.pendingOrders = this.pendingOrders.filter(o => o.symbol !== symbol);

            res.json({ status: 'ok', commands });
        });

        this.app.get('/status', (req, res) => {
            res.json({ status: 'running', server: 'APEX Bridge' });
        });
    }

    addOrder(order) {
        this.pendingOrders.push(order);
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`APEX: REST Bridge Server running at http://localhost:${this.port}`);
            console.log(`APEX: Web Dashboard at http://localhost:${this.port}`);
        });
    }
}

module.exports = new BridgeServer();
