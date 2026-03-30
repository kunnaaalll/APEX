/**
 * APEX Accuracy Gate & Performance Tracker
 * 
 * Tracks progress toward 70%+ win rate over 1000 trades.
 * Provides rolling performance metrics and milestone tracking.
 */

const journal = require('../db/journal');
const dashboard = require('../web/webDashboard');
const telegram = require('../notify/telegram');

class AccuracyGate {
    constructor() {
        this.stats = {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            breakevens: 0,
            totalPnL: 0,
            grossProfit: 0,
            grossLoss: 0,
            winRate: 0,
            avgRR: 0,
            profitFactor: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            peakPnL: 0,
            bestTrade: 0,
            worstTrade: 0,
            avgWin: 0,
            avgLoss: 0,
            longestWinStreak: 0,
            longestLoseStreak: 0,
            currentStreak: 0,
            streakType: 'NONE'
        };

        this.symbolStats = {};
        this.sessionStats = {};
        this.patternStats = {};
        this.tradeHistory = []; // Last N trades for rolling calcs
        this.milestones = [100, 250, 500, 750, 1000];
        this.milestonesHit = new Set();

        // Rolling windows
        this.rolling50 = [];
        this.rolling100 = [];

        // Target
        this.targetTrades = 1000;
        this.targetWinRate = 70;

        // Load from DB on startup
        this.loadFromDB();
    }

    /**
     * Load historical stats from database
     */
    async loadFromDB() {
        try {
            const trades = await new Promise((resolve, reject) => {
                journal.db.all(
                    "SELECT * FROM trades WHERE status = 'CLOSED' ORDER BY timestamp ASC",
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            for (const trade of trades) {
                this.addTradeToStats(trade, false); // Don't save back to DB
            }

            if (trades.length > 0) {
                dashboard.logMessage(`📊 AccuracyGate: Loaded ${trades.length} historical trades. Win Rate: ${this.stats.winRate.toFixed(1)}%`);
            }
        } catch (e) {
            console.error('AccuracyGate: DB load error:', e.message);
        }
    }

    /**
     * Record a new closed trade
     */
    recordTrade(tradeData) {
        this.addTradeToStats(tradeData, true);
        this.checkMilestones();
        this.broadcastStats();
    }

    /**
     * Add trade to all stats
     */
    addTradeToStats(trade, isNew = true) {
        const pnl = parseFloat(trade.pnl || 0);
        const outcome = trade.outcome || (pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN');
        const symbol = trade.symbol || 'UNKNOWN';
        const session = trade.session || this.getCurrentSession();

        this.stats.totalTrades++;
        this.stats.totalPnL += pnl;

        if (outcome === 'WIN') {
            this.stats.wins++;
            this.stats.grossProfit += pnl;
            this.stats.bestTrade = Math.max(this.stats.bestTrade, pnl);
        } else if (outcome === 'LOSS') {
            this.stats.losses++;
            this.stats.grossLoss += Math.abs(pnl);
            this.stats.worstTrade = Math.min(this.stats.worstTrade, pnl);
        } else {
            this.stats.breakevens++;
        }

        // Win rate
        const totalDecided = this.stats.wins + this.stats.losses;
        this.stats.winRate = totalDecided > 0 ? (this.stats.wins / totalDecided) * 100 : 0;

        // Averages
        this.stats.avgWin = this.stats.wins > 0 ? this.stats.grossProfit / this.stats.wins : 0;
        this.stats.avgLoss = this.stats.losses > 0 ? this.stats.grossLoss / this.stats.losses : 0;

        // Profit factor
        this.stats.profitFactor = this.stats.grossLoss > 0 ? this.stats.grossProfit / this.stats.grossLoss : this.stats.grossProfit > 0 ? Infinity : 0;

        // Average RR
        this.stats.avgRR = this.stats.avgLoss > 0 ? this.stats.avgWin / this.stats.avgLoss : 0;

        // Drawdown
        if (this.stats.totalPnL > this.stats.peakPnL) {
            this.stats.peakPnL = this.stats.totalPnL;
        }
        this.stats.currentDrawdown = this.stats.peakPnL - this.stats.totalPnL;
        this.stats.maxDrawdown = Math.max(this.stats.maxDrawdown, this.stats.currentDrawdown);

        // Streaks
        if (outcome === 'WIN') {
            if (this.stats.streakType === 'WIN') {
                this.stats.currentStreak++;
            } else {
                this.stats.currentStreak = 1;
                this.stats.streakType = 'WIN';
            }
            this.stats.longestWinStreak = Math.max(this.stats.longestWinStreak, this.stats.currentStreak);
        } else if (outcome === 'LOSS') {
            if (this.stats.streakType === 'LOSS') {
                this.stats.currentStreak++;
            } else {
                this.stats.currentStreak = 1;
                this.stats.streakType = 'LOSS';
            }
            this.stats.longestLoseStreak = Math.max(this.stats.longestLoseStreak, this.stats.currentStreak);
        }

        // Rolling windows
        const tradeEntry = { outcome, pnl, symbol, session, timestamp: trade.timestamp || new Date().toISOString() };
        this.tradeHistory.push(tradeEntry);
        this.rolling50.push(tradeEntry);
        this.rolling100.push(tradeEntry);
        if (this.rolling50.length > 50) this.rolling50.shift();
        if (this.rolling100.length > 100) this.rolling100.shift();

        // Per-symbol stats
        if (!this.symbolStats[symbol]) {
            this.symbolStats[symbol] = { trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0 };
        }
        const ss = this.symbolStats[symbol];
        ss.trades++;
        if (outcome === 'WIN') ss.wins++;
        else if (outcome === 'LOSS') ss.losses++;
        ss.pnl += pnl;
        ss.winRate = (ss.wins + ss.losses) > 0 ? (ss.wins / (ss.wins + ss.losses)) * 100 : 0;

        // Per-session stats
        if (!this.sessionStats[session]) {
            this.sessionStats[session] = { trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0 };
        }
        const ses = this.sessionStats[session];
        ses.trades++;
        if (outcome === 'WIN') ses.wins++;
        else if (outcome === 'LOSS') ses.losses++;
        ses.pnl += pnl;
        ses.winRate = (ses.wins + ses.losses) > 0 ? (ses.wins / (ses.wins + ses.losses)) * 100 : 0;

        // Log new trades
        if (isNew) {
            dashboard.logMessage(
                `📊 Trade #${this.stats.totalTrades}/${this.targetTrades} | ${outcome} | $${pnl.toFixed(2)} | ` +
                `Win Rate: ${this.stats.winRate.toFixed(1)}% (target: ${this.targetWinRate}%) | ` +
                `Total PnL: $${this.stats.totalPnL.toFixed(2)} | PF: ${this.stats.profitFactor.toFixed(2)}`
            );
        }
    }

    /**
     * Check and alert on milestones
     */
    checkMilestones() {
        for (const milestone of this.milestones) {
            if (this.stats.totalTrades >= milestone && !this.milestonesHit.has(milestone)) {
                this.milestonesHit.add(milestone);
                
                const report = this.generateReport();
                dashboard.logMessage(`🏆 MILESTONE: ${milestone} trades completed!`, 'info');
                dashboard.logMessage(report, 'info');
                
                // Send to Telegram
                telegram.send(`🏆 *APEX Milestone: ${milestone} Trades*\n\n${report}`).catch(() => {});
            }
        }

        // Check if target achieved
        if (this.stats.totalTrades >= this.targetTrades && this.stats.winRate >= this.targetWinRate) {
            dashboard.logMessage(`🎯 TARGET ACHIEVED! ${this.stats.totalTrades} trades with ${this.stats.winRate.toFixed(1)}% win rate!`, 'info');
            telegram.send(`🎯 *APEX TARGET ACHIEVED!*\n${this.stats.totalTrades} trades | ${this.stats.winRate.toFixed(1)}% win rate | PF: ${this.stats.profitFactor.toFixed(2)}`).catch(() => {});
        }
    }

    /**
     * Get rolling window stats
     */
    getRollingStats(window) {
        const trades = window === 50 ? this.rolling50 : this.rolling100;
        if (trades.length === 0) return { winRate: 0, pnl: 0, count: 0 };

        const wins = trades.filter(t => t.outcome === 'WIN').length;
        const losses = trades.filter(t => t.outcome === 'LOSS').length;
        const pnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const decided = wins + losses;

        return {
            winRate: decided > 0 ? (wins / decided * 100).toFixed(1) : 0,
            wins,
            losses,
            pnl: pnl.toFixed(2),
            count: trades.length
        };
    }

    /**
     * Generate performance report
     */
    generateReport() {
        const r50 = this.getRollingStats(50);
        const r100 = this.getRollingStats(100);

        return [
            `📈 APEX Performance Report`,
            `━━━━━━━━━━━━━━━━━━━━━━━━`,
            `Total Trades: ${this.stats.totalTrades}/${this.targetTrades}`,
            `Win Rate: ${this.stats.winRate.toFixed(1)}% (target: ${this.targetWinRate}%)`,
            `Profit Factor: ${this.stats.profitFactor.toFixed(2)}`,
            `Avg R:R: ${this.stats.avgRR.toFixed(2)}`,
            `Total PnL: $${this.stats.totalPnL.toFixed(2)}`,
            `Max Drawdown: $${this.stats.maxDrawdown.toFixed(2)}`,
            `Best Trade: $${this.stats.bestTrade.toFixed(2)}`,
            `Worst Trade: $${this.stats.worstTrade.toFixed(2)}`,
            `Win Streak: ${this.stats.longestWinStreak} | Lose Streak: ${this.stats.longestLoseStreak}`,
            ``,
            `Rolling 50: ${r50.winRate}% WR (${r50.wins}W/${r50.losses}L) PnL: $${r50.pnl}`,
            `Rolling 100: ${r100.winRate}% WR (${r100.wins}W/${r100.losses}L) PnL: $${r100.pnl}`,
            ``,
            `Per Symbol:`,
            ...Object.entries(this.symbolStats).map(([sym, s]) => 
                `  ${sym}: ${s.winRate.toFixed(0)}% WR (${s.trades} trades) $${s.pnl.toFixed(2)}`
            ),
            ``,
            `Per Session:`,
            ...Object.entries(this.sessionStats).map(([ses, s]) => 
                `  ${ses}: ${s.winRate.toFixed(0)}% WR (${s.trades} trades) $${s.pnl.toFixed(2)}`
            )
        ].join('\n');
    }

    /**
     * Get current session name
     */
    getCurrentSession() {
        const hour = new Date().getUTCHours();
        if (hour >= 7 && hour < 12) return 'london';
        if (hour >= 12 && hour < 16) return 'ny_overlap';
        if (hour >= 16 && hour < 20) return 'ny';
        if (hour >= 0 && hour < 7) return 'asian';
        return 'off_hours';
    }

    /**
     * Broadcast stats to dashboard
     */
    broadcastStats() {
        dashboard.broadcast('performance', {
            totalTrades: this.stats.totalTrades,
            targetTrades: this.targetTrades,
            winRate: this.stats.winRate.toFixed(1),
            targetWinRate: this.targetWinRate,
            profitFactor: this.stats.profitFactor.toFixed(2),
            totalPnL: this.stats.totalPnL.toFixed(2),
            maxDrawdown: this.stats.maxDrawdown.toFixed(2),
            currentStreak: this.stats.currentStreak,
            streakType: this.stats.streakType,
            avgRR: this.stats.avgRR.toFixed(2),
            symbolStats: this.symbolStats,
            sessionStats: this.sessionStats
        });
    }

    /**
     * Get full stats object for LLM context
     */
    getStatsForLLM() {
        return {
            totalTrades: this.stats.totalTrades,
            winRate: this.stats.winRate.toFixed(1),
            profitFactor: this.stats.profitFactor.toFixed(2),
            avgRR: this.stats.avgRR.toFixed(2),
            currentStreak: `${this.stats.currentStreak} ${this.stats.streakType}`,
            recentPerformance: this.getRollingStats(50),
            symbolPerformance: this.symbolStats,
            sessionPerformance: this.sessionStats,
            maxDrawdown: this.stats.maxDrawdown.toFixed(2)
        };
    }
}

module.exports = new AccuracyGate();
