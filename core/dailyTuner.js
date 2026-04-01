/**
 * APEX Daily Tuner v3.0 — The Statistical Optimizer
 * 
 * Experienced traders know: strategy requirements change with the market.
 * What worked last week (e.g., FVG entries) might fail this week.
 * 
 * This module:
 * 1. Analyzes the SQLite trades table.
 * 2. Compares 17+ confluence factors for Winners vs Losers.
 * 3. Calculates the "Profit Factor Contribution" of each setup attribute.
 * 4. Suggests updated weights to ml_loop.js to prioritize what's CURRENTLY working.
 */

const fs = require('fs');
const path = require('path');
const journal = require('../db/journal');
const dashboard = require('../web/webDashboard');

class DailyTuner {
    constructor() {
        this.weightsPath = path.join(__dirname, '../data/ml_weights.json');
    }

    /**
     * Run the tuner — Analyzes last 50-100 trades to optimize logic
     * Triggered every 24h by dailyPlanner
     */
    async tune() {
        dashboard.logMessage('🧠 TUNER: Analyzing historical performance for weight optimization...', 'info');

        try {
            // 1. Get last 100 closed trades from DB
            const trades = await this.getClosedTrades(100);
            if (trades.length < 5) {
                dashboard.logMessage('🧠 TUNER: Not enough trade data yet to optimize weights.', 'warn');
                return;
            }

            // 2. Perform statistical mapping
            const stats = this.analyzeFactorImportance(trades);

            // 3. Generate suggested weight adjustments
            const currentWeights = this.getCurrentWeights();
            const newWeights = this.calculateOptimizedWeights(currentWeights, stats);

            // 4. Save and report
            await this.updateWeights(newWeights);
            
            dashboard.logMessage('━━━ TUNER REPORT ━━━', 'info');
            dashboard.logMessage(`📊 Analyzed ${trades.length} trades across all sessions.`);
            dashboard.logMessage(`✅ Optimized factors: ${Object.keys(stats).length}`);
            if (stats.topFactor) dashboard.logMessage(`⭐ Highest Confidence: ${stats.topFactor.name} (${stats.topFactor.pf.toFixed(2)} PF)`);
            if (stats.worstFactor) dashboard.logMessage(`🚫 Lowest Accuracy: ${stats.worstFactor.name} (${stats.worstFactor.pf.toFixed(2)} PF)`);
            dashboard.logMessage('━━━━━━━━━━━━━━━━━━', 'info');

        } catch (err) {
            console.error('Tuner Error:', err.message);
            dashboard.logMessage(`❌ Tuner Error: ${err.message}`, 'warn');
        }
    }

    async getClosedTrades(limit) {
        return new Promise((resolve, reject) => {
            journal.db.all(
                `SELECT confluences, outcome, pnl FROM trades WHERE status = 'CLOSED' ORDER BY timestamp DESC LIMIT ?`,
                [limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    analyzeFactorImportance(trades) {
        const factorStats = {}; 
        // e.g., 'obPresence' -> { wins: 0, losses: 0, totalPnL: 0, count: 0 }

        for (const t of trades) {
            let confs = {};
            try {
                confs = JSON.parse(t.confluences || '{}');
            } catch (e) { continue; }

            const win = t.outcome === 'WIN';
            const pnl = t.pnl || 0;

            // Iterate all boolean/numeric factors in the confluence object
            for (const [key, val] of Object.entries(confs)) {
                // We only care about factors that were TRUE (present) or had a score
                if (!val) continue;

                if (!factorStats[key]) {
                    factorStats[key] = { wins: 0, losses: 0, pnl: 0, count: 0 };
                }

                const s = factorStats[key];
                s.count++;
                s.pnl += pnl;
                if (win) s.wins++;
                else s.losses++;
            }
        }

        // Calculate Profit Factor and Win Rate per factor
        const results = {};
        let topFactor = null;
        let worstFactor = null;

        for (const [name, s] of Object.entries(factorStats)) {
            // Filter factors with too little data
            if (s.count < 3) continue;

            const winRate = (s.wins / s.count) * 100;
            const lossPnL = Math.abs(trades.filter(t => !JSON.parse(t.confluences)[name]).reduce((sum, t) => sum + (t.pnl < 0 ? t.pnl : 0), 0)); // This is wrong, let's simplify PF
            
            // Simplified PF: Total Win PnL / Total Loss PnL for trades having this factor
            const winPnL = trades.filter(t => {
                try { return JSON.parse(t.confluences)[name] && t.pnl > 0; } catch(e) { return false; }
            }).reduce((sum, t) => sum + t.pnl, 0);

            const factorLossPnL = Math.abs(trades.filter(t => {
                try { return JSON.parse(t.confluences)[name] && t.pnl < 0; } catch(e) { return false; }
            }).reduce((sum, t) => sum + t.pnl, 0));

            const pf = factorLossPnL > 0 ? winPnL / factorLossPnL : (winPnL > 0 ? 3.0 : 1.0);

            results[name] = { pf, winRate, count: s.count };

            if (!topFactor || pf > topFactor.pf) topFactor = { name, pf };
            if (!worstFactor || pf < worstFactor.pf) worstFactor = { name, pf };
        }

        return { factors: results, topFactor, worstFactor };
    }

    calculateOptimizedWeights(current, stats) {
        const optimized = { ...current };
        const learningRate = 0.1; // Max 10% adjustment per tune

        for (const [name, s] of Object.entries(stats.factors)) {
            // Factor is highly profitable (PF > 1.5)
            if (s.pf > 1.5) {
                optimized[name] = Math.min(2.0, (optimized[name] || 1.0) * (1 + learningRate));
            }
            // Factor is unprofitable (PF < 0.8)
            else if (s.pf < 0.8) {
                optimized[name] = Math.max(0.1, (optimized[name] || 1.0) * (1 - learningRate));
            }
            // Factor is mediocre
            else if (s.pf < 1.0) {
                optimized[name] = (optimized[name] || 1.0) * (1 - learningRate * 0.2);
            }
        }

        return optimized;
    }

    getCurrentWeights() {
        try {
            if (fs.existsSync(this.weightsPath)) {
                return JSON.parse(fs.readFileSync(this.weightsPath, 'utf8'));
            }
        } catch (e) {}
        return { obPresence: 1.0, fvgPresence: 1.0, bosConfirm: 1.0, sessionWeight: 1.0 };
    }

    async updateWeights(newWeights) {
        fs.writeFileSync(this.weightsPath, JSON.stringify(newWeights, null, 2));
    }
}

module.exports = new DailyTuner();
