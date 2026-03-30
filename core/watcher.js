const events = require('events');
const server = require('./server');

class MT5Watcher extends events.EventEmitter {
    constructor() {
        super();
        this.symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
        this.timeframes = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
    }

    start() {
        console.log('Watcher: Initializing REST Bridge Listener...');
        
        server.on('market_data', (data) => {
            // Forward market data as events for the detector
            this.emit('data', data);
        });

        server.on('account_info', (info) => {
            this.emit('account', info);
        });

        // Start the server
        server.start();
    }

    sendToBridge(message) {
        // Enqueue command for the next poll
        server.addOrder(message);
    }

    stop() {
        console.log('Watcher: Stopping REST Bridge...');
    }
}

module.exports = new MT5Watcher();
