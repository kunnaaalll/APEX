const path = require('path');
const events = require('events');

class WebDashboard extends events.EventEmitter {
    constructor() {
        super();
        this.clients = [];
        this.logs = [];
        this.trades = [];
        this.stats = { balance: 0, equity: 0, margin: 0, winRate: 0, tradeCount: 0 };
        this.lastConfluence = 0;
    }

    // Attach SSE routes to the existing express app
    attach(app) {
        // Serve the dashboard HTML
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../web/dashboard.html'));
        });

        // SSE endpoint
        app.get('/events', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });

            this.clients.push(res);
            console.log(`Dashboard: Client connected (${this.clients.length} total)`);

            req.on('close', () => {
                this.clients = this.clients.filter(c => c !== res);
                console.log(`Dashboard: Client disconnected (${this.clients.length} total)`);
            });
        });
    }

    broadcast(event, data) {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients.forEach(client => {
            try { client.write(msg); } catch (e) { /* stale */ }
        });
    }

    logMessage(msg, type = 'msg') {
        const entry = { message: msg, type, time: new Date().toISOString() };
        this.logs.push(entry);
        if (this.logs.length > 200) this.logs.shift();
        this.broadcast('log', entry);
        // Also print to console for terminal visibility
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    updateStats(data) {
        this.stats = { ...this.stats, ...data };
        this.broadcast('stats', this.stats);
    }

    updateTrades(trades) {
        this.trades = trades;
        trades.forEach(t => this.broadcast('trade', t));
    }

    sendMarketData(data) {
        this.broadcast('market_data', data);
    }

    sendAccountInfo(info) {
        this.broadcast('account', info);
    }

    sendCouncilDecision(decision) {
        this.broadcast('council', decision);
    }

    sendConfluence(score) {
        this.lastConfluence = score;
        this.broadcast('confluence', { score });
    }

    render() {
        // No-op for compatibility with old terminal dashboard calls
    }
}

module.exports = new WebDashboard();
