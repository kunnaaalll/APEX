const path = require('path');
const events = require('events');
const express = require('express');

class WebDashboard extends events.EventEmitter {
    constructor() {
        super();
        this.clients = [];
        this.history = []; 
        this.maxHistory = 25; // ⚡ PERFORMANCE: Reduced buffer for faster first-paint
    }

    attach(app) {
        // Parse JSON only for dashboard-specific routes (NOT globally — global parsing breaks the /update route for MT5)
        const jsonParser = express.json({ limit: '50mb' });
        const urlencodedParser = express.urlencoded({ extended: true, limit: '50mb' });

        const distPath = path.join(__dirname, '../web-v6/dist');
        app.use(express.static(distPath));

        app.get('/', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });

        // 🗣️ NEURAL COMMAND CHAT ENDPOINTS
        app.post('/chat', jsonParser, async (req, res) => {
            const { message, context } = req.body;
            if (!message) return res.status(400).json({ status: 'error', reason: 'Empty command pulse.' });
            
            const commandExpert = require('../llm/commandExpert');
            try {
                const result = await commandExpert.processMessage(message, context);
                res.json({ status: 'ok', response: result });
            } catch (e) {
                this.logMessage(`🚨 Neural Link Error: ${e.message}`, 'error');
                res.status(500).json({ status: 'error', reason: 'Brain state unreachable.' });
            }
        });

        app.post('/confirm', jsonParser, async (req, res) => {
            const { command } = req.body;
            const commandExpert = require('../llm/commandExpert');
            await commandExpert.executeConfirmedCommand(command);
            res.json({ status: 'ok' });
        });

        app.post('/config', jsonParser, async (req, res) => {
            const riskGuard = require('../core/riskGuard');
            const newStatus = riskGuard.updateConfig(req.body);
            this.broadcast('risk_status', newStatus);
            res.json({ status: 'ok', config: newStatus });
        });

        app.post('/strike', jsonParser, async (req, res) => {
            const { symbol, direction } = req.body;
            const orderManager = require('../core/orderManager');
            
            try {
                this.logMessage(`🎯 MANUAL STRIKE REQUEST: ${symbol} ${direction}`, 'info');
                const result = await orderManager.manualStrike(symbol, direction || 'BUY');
                
                if (result.status === 'ok') {
                    res.json({ status: 'ok' });
                } else {
                    res.status(403).json({ status: 'error', reason: result.reason });
                }
            } catch (e) {
                this.logMessage(`🚨 Strike Execution Failed: ${e.message}`, 'error');
                res.status(500).json({ status: 'error', reason: 'Execution engine error: ' + e.message });
            }
        });

        app.get('/events', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            
            res.write('event: ping\ndata: {}\n\n');
            
            // 📡 Replay history with a slight delay
            setTimeout(() => {
                this.history.forEach(item => {
                    try {
                        res.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
                    } catch(e) {}
                });
            }, 100);

            this.clients.push(res);
            req.on('close', () => { this.clients = this.clients.filter(c => c !== res); });
        });
    }

    addToHistory(event, data) {
        this.history.push({ event, data });
        if (this.history.length > this.maxHistory) this.history.shift();
    }

    broadcast(event, data) {
        if (['council', 'trade', 'log', 'performance', 'risk_status', 'stats', 'calendar'].includes(event)) {
            this.addToHistory(event, data);
        }

        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients = this.clients.filter(client => {
            try { client.write(msg); return true; }
            catch (e) { return false; }
        });
    }

    logMessage(msg, type = 'msg') {
        const time = new Date().toLocaleTimeString('en-US', {hour12:false});
        const logData = { message: msg, type, time };
        this.broadcast('log', logData);
        console.log(`[${time}] ${msg}`);
    }

    updateStats(data) { this.broadcast('stats', data); }

    updateTrades(positions) {
        if (!positions) return;
        const trades = positions.map(pos => ({
            symbol: pos.symbol,
            direction: (pos.type === 0 || pos.type === 'BUY') ? 'BUY' : 'SELL',
            entry: pos.price_open || pos.entry || 0,
            sl: pos.sl || 0,
            tp: pos.tp || 0,
            profit: pos.profit || 0,
            volume: pos.volume || 0.1,
            time: pos.time || new Date().toLocaleTimeString('en-US', {hour12:false})
        }));
        
        this.broadcast('clear_trades', {});
        trades.forEach(t => this.broadcast('trade', t));
    }

    sendMarketData(data) { this.broadcast('market_data', data); }
    sendAccountInfo(info) { 
        this.broadcast('account', info);
        if (info && info.positions) this.updateTrades(info.positions);
    }

    sendCouncilDecision(decision) {
        decision.time = new Date().toLocaleTimeString('en-US', {hour12:false});
        this.broadcast('council', decision);
    }
    
    sendIntelligence(intel) {
        this.broadcast('intelligence', intel);
    }

    sendConfluence(symbol, score) { this.broadcast('confluence', { symbol, score }); }
    render() {}
}

module.exports = new WebDashboard();
