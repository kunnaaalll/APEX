const path = require('path');
const events = require('events');

class WebDashboard extends events.EventEmitter {
    constructor() {
        super();
        this.clients = [];
        this.history = []; 
        this.maxHistory = 100;
    }

    attach(app) {
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'dashboard.html'));
        });

        app.get('/events', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            
            res.write('event: ping\ndata: {}\n\n');
            
            // 📡 Replay history with a slight delay to ensure browser is ready
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
        if (['council', 'trade', 'log', 'performance', 'risk_status', 'stats'].includes(event)) {
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
        // 🛠️ MAP MT5 POSITIONS TO UI FORMAT
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
        
        // Clear old ones on UI then send new ones
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
    
    sendConfluence(symbol, score) { this.broadcast('confluence', { symbol, score }); }
    render() {}
}

module.exports = new WebDashboard();
