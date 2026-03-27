require('dotenv').config();
const watcher = require('./core/watcher');
const detector = require('./core/detector');
const dashboard = require('./web/webDashboard');
const journal = require('./db/journal');

async function main() {
    dashboard.logMessage('APEX: System initializing...');
    
    // 0. Load existing data
    const openTrades = await journal.getOpenTrades();
    dashboard.updateTrades(openTrades);
    dashboard.logMessage(`Loaded ${openTrades.length} open trades from database.`);

    dashboard.logMessage(`AI Engine: OpenRouter (${process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'})`);
    dashboard.logMessage(`Mode: ${process.env.TRADING_MODE || 'demo'}`);

    // Update Stats Sample
    dashboard.updateStats({ balance: 10000, equity: 10000, margin: 0, winRate: 0, tradeCount: 0 });

    // 1. Initialise Watcher
    watcher.start();
    
    // 2. React to New Market Data
    watcher.on('data', ({ symbol, timeframe, candles }) => {
        dashboard.logMessage(`Data Received: ${symbol} ${timeframe}`);
        // Only react to closed candles
        if (candles && candles.length > 0) {
            detector.onNewCandle(symbol, timeframe, candles);
        }
    });

    dashboard.logMessage('APEX: System live. Monitoring symbols: ' + watcher.symbols.join(', '));
    dashboard.logMessage('APEX: Web Dashboard at http://localhost:3000');
    dashboard.render();
}

main();
