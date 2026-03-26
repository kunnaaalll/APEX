const path = require('path');
const events = require('events');

class WebDashboard extends events.EventEmitter {
    constructor() {
        super();
        this.clients = [];
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
            // Send a ping immediately so the connection opens
            res.write('event: ping\ndata: {}\n\n');
            this.clients.push(res);
            console.log(`Dashboard: Browser connected (${this.clients.length} clients)`);

            req.on('close', () => {
                this.clients = this.clients.filter(c => c !== res);
                console.log(`Dashboard: Browser disconnected (${this.clients.length} clients)`);
            });
        });
    }

    broadcast(event, data) {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients = this.clients.filter(client => {
            try { client.write(msg); return true; }
            catch (e) { return false; }
        });
    }

    logMessage(msg, type = 'msg') {
        this.broadcast('log', { message: msg, type });
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    updateStats(data) { this.broadcast('stats', data); }
    updateTrades(trades) { trades.forEach(t => this.broadcast('trade', t)); }
    sendMarketData(data) { this.broadcast('market_data', data); }
    sendAccountInfo(info) { this.broadcast('account', info); }
    sendCouncilDecision(decision) { this.broadcast('council', decision); }
    sendConfluence(symbol, score) { this.broadcast('confluence', { symbol, score }); }
    render() {}
}

module.exports = new WebDashboard();
