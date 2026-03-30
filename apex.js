/**
 * APEX v2.0 — Autonomous Price Execution Agent
 * 
 * Intelligent trading system that acts like a 20-year experienced trader.
 * Manages trades before, during, and after execution.
 * Learns from every trade to reach 70%+ accuracy over 1000 trades.
 */

require('dotenv').config();
const watcher = require('./core/watcher');
const detector = require('./core/detector');
const dashboard = require('./web/webDashboard');
const journal = require('./db/journal');
const mlLoop = require('./core/ml_loop');
const server = require('./core/server');
const riskGuard = require('./core/riskGuard');
const tradeManager = require('./core/tradeManager');
const accuracyGate = require('./eval/accuracyGate');
const telegram = require('./notify/telegram');

async function main() {
    dashboard.logMessage('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    dashboard.logMessage('   APEX v2.0 — Intelligent Trade Manager   ');
    dashboard.logMessage('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    dashboard.logMessage('🧠 Learning System: ACTIVE');
    dashboard.logMessage('📊 Trade Manager: ACTIVE');
    dashboard.logMessage('🛡️ Risk Guard: ACTIVE');
    dashboard.logMessage(`🎯 Target: ${accuracyGate.targetWinRate}%+ win rate over ${accuracyGate.targetTrades} trades`);

    // 0. Load existing data
    const openTrades = await journal.getOpenTrades();
    dashboard.updateTrades(openTrades);
    dashboard.logMessage(`Loaded ${openTrades.length} open trades from database.`);

    dashboard.logMessage(`🤖 AI Engine: OpenRouter (${process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'})`);
    dashboard.logMessage(`📈 Mode: ${process.env.TRADING_MODE || 'demo'}`);
    dashboard.logMessage(`💰 Risk: ${process.env.DEFAULT_RISK_PERCENT || 1}% per trade`);
    dashboard.logMessage(`🔒 Max Trades: ${process.env.MAX_SIMULTANEOUS_TRADES || 3}`);
    dashboard.logMessage(`📉 Daily Loss Limit: ${process.env.DAILY_LOSS_LIMIT || 3}%`);

    // Load accuracy stats
    const stats = accuracyGate.stats;
    if (stats.totalTrades > 0) {
        dashboard.logMessage(`📊 Performance: ${stats.totalTrades} trades | ${stats.winRate.toFixed(1)}% WR | PF: ${stats.profitFactor.toFixed(2)}`);
    }

    dashboard.updateStats({ 
        balance: 10000, equity: 10000, margin: 0, 
        winRate: stats.winRate || 0, 
        tradeCount: stats.totalTrades || 0 
    });

    // 1. Initialize Watcher
    watcher.start();

    let knownOpenPositions = {};

    // 2. React to New Market Data
    watcher.on('data', ({ symbol, timeframe, candles, positions, spread, ask, bid }) => {
        dashboard.logMessage(`📡 Data: ${symbol} ${timeframe}`);

        // === ACTIVE TRADE MANAGEMENT (every tick) ===
        if (positions && positions.length > 0) {
            // Update risk guard with current positions
            riskGuard.updatePositions(positions);

            // Update trade manager — handles breakeven, trailing, partials
            tradeManager.onTickUpdate(positions);

            // Update dashboard with live positions
            dashboard.updateTrades(positions);
        }

        // === SETUP DETECTION (only if no active trade on this symbol) ===
        if (candles && candles.length > 0) {
            const hasActiveTrade = Object.values(knownOpenPositions).some(p => p.symbol === symbol);
            const hasPendingTrade = server.pendingOrders.some(o => o.symbol === symbol);

            if (!hasActiveTrade && !hasPendingTrade) {
                detector.onNewCandle(symbol, timeframe, candles, { spread, ask, bid });
            }
        }

        // === POSITION LIFECYCLE TRACKING ===
        if (positions) {
            const currentTickets = new Set(positions.map(p => p.ticket));

            // Check for CLOSED positions
            for (const ticket in knownOpenPositions) {
                if (!currentTickets.has(Number(ticket))) {
                    const closedTrade = knownOpenPositions[ticket];
                    
                    dashboard.logMessage(
                        `📕 Trade CLOSED: ${closedTrade.symbol} #${ticket} | ` +
                        `PnL: $${(closedTrade.profit || 0).toFixed(2)} | ` +
                        `MFE: $${(closedTrade.max_favorable_excursion || 0).toFixed(2)} | ` +
                        `MAE: $${(closedTrade.max_adverse_excursion || 0).toFixed(2)}`
                    );

                    // Record result in risk guard
                    riskGuard.recordTradeResult(closedTrade.profit || 0);

                    // Notify trade manager
                    tradeManager.onTradeClosed(ticket);

                    // Full ML loop processing (learn from this trade)
                    mlLoop.processClosedTrade(closedTrade).catch(err => {
                        console.error('ML Loop error:', err.message);
                    });

                    // Send Telegram notification
                    const pnl = (closedTrade.profit || 0).toFixed(2);
                    const outcome = closedTrade.profit > 0 ? '🟢 WIN' : '🔴 LOSS';
                    telegram.send(
                        `${outcome} *Trade Closed*\n` +
                        `Symbol: ${closedTrade.symbol}\n` +
                        `PnL: $${pnl}\n` +
                        `Stats: ${accuracyGate.stats.totalTrades + 1} trades | ${accuracyGate.stats.winRate.toFixed(1)}% WR`
                    ).catch(() => {});

                    delete knownOpenPositions[ticket];
                }
            }

            // Track NEW and UPDATE positions
            positions.forEach(p => {
                if (!knownOpenPositions[p.ticket]) {
                    // New position detected
                    knownOpenPositions[p.ticket] = {
                        ...p,
                        max_favorable_excursion: p.profit || 0,
                        max_adverse_excursion: p.profit || 0
                    };

                    dashboard.logMessage(`📗 New Position: ${p.symbol} #${p.ticket} ${p.type === 0 ? 'BUY' : 'SELL'} @ ${p.price_open}`);

                    // Register with trade manager for active management
                    tradeManager.registerTrade(p.ticket, p);

                } else {
                    // Update existing position tracking
                    const pos = knownOpenPositions[p.ticket];
                    pos.max_favorable_excursion = Math.max(pos.max_favorable_excursion, p.profit || 0);
                    pos.max_adverse_excursion = Math.min(pos.max_adverse_excursion, p.profit || 0);
                    pos.profit = p.profit;
                    pos.sl = p.sl;
                    pos.tp = p.tp;
                }
            });
        }
    });

    // 3. React to Account Updates
    watcher.on('account', (info) => {
        if (info) {
            riskGuard.updateAccount(info);
            dashboard.updateStats({
                balance: info.balance,
                equity: info.equity,
                margin: info.margin || 0,
                winRate: accuracyGate.stats.winRate,
                tradeCount: accuracyGate.stats.totalTrades,
                profitFactor: accuracyGate.stats.profitFactor,
                totalPnL: accuracyGate.stats.totalPnL,
                drawdown: riskGuard.getStatus().currentDrawdown
            });
        }
    });

    // 4. Periodic risk status broadcast
    setInterval(() => {
        const riskStatus = riskGuard.getStatus();
        dashboard.broadcast('risk_status', riskStatus);
    }, 30000); // Every 30 seconds

    // 5. Periodic performance snapshot
    setInterval(async () => {
        try {
            const s = accuracyGate.stats;
            if (s.totalTrades > 0) {
                await journal.savePerformanceSnapshot({
                    totalTrades: s.totalTrades,
                    winRate: s.winRate,
                    profitFactor: s.profitFactor,
                    avgRR: s.avgRR,
                    maxDrawdown: s.maxDrawdown,
                    totalPnL: s.totalPnL
                });
            }
        } catch (e) {}
    }, 300000); // Every 5 minutes

    dashboard.logMessage('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    dashboard.logMessage('APEX v2.0: SYSTEM LIVE');
    dashboard.logMessage('Monitoring: ' + watcher.symbols.join(', '));
    dashboard.logMessage('Dashboard: http://localhost:3000');
    dashboard.logMessage('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    dashboard.render();
}

main();
