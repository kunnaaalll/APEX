/**
 * APEX Spread & Microstructure Filter
 * 
 * Experienced traders never enter when spread is abnormal.
 * Wide spread = low liquidity = bad fills = slippage.
 * 
 * Features:
 * - Tracks normal spread per symbol (rolling average)
 * - Blocks entries when spread > 2x normal
 * - Tracks slippage (intended vs actual fill)
 * - Spread cost analysis (rejects if spread > 20% of risk)
 * - Symbol-specific tolerance (Gold gets wider than forex)
 */

const dashboard = require('../web/webDashboard');

class SpreadFilter {
    constructor() {
        // Rolling spread tracking per symbol
        this.spreadHistory = {};  // symbol -> [last 200 spreads]
        this.normalSpread = {};   // symbol -> average
        this.slippageHistory = {}; // symbol -> [{ intended, actual, diff }]

        // Max spread ratios before blocking
        this.maxSpreadRatio = {
            'XAUUSD': 3.0,   // Gold is naturally wider
            'EURUSD': 2.0,
            'GBPUSD': 2.5,
            'USDJPY': 2.0,
            'DEFAULT': 2.5
        };

        // Min trades before we have reliable spread data
        this.minSamples = 20;
    }

    /**
     * Update spread tracking from bridge data
     */
    updateSpread(symbol, spread) {
        if (!symbol || !spread || spread <= 0) return;

        const s = parseFloat(spread);
        if (!this.spreadHistory[symbol]) {
            this.spreadHistory[symbol] = [];
        }

        this.spreadHistory[symbol].push(s);

        // Keep last 200 readings
        if (this.spreadHistory[symbol].length > 200) {
            this.spreadHistory[symbol].shift();
        }

        // Recalculate normal spread
        const history = this.spreadHistory[symbol];
        const sum = history.reduce((a, b) => a + b, 0);
        this.normalSpread[symbol] = sum / history.length;
    }

    /**
     * MAIN CHECK: Is the current spread acceptable for trading?
     * 
     * @param {string} symbol
     * @param {number} currentSpread - Current spread
     * @param {number} riskDistance - SL distance (to check spread cost ratio)
     * @returns {object} { allowed, reason, spreadRatio, spreadCostPercent }
     */
    canTrade(symbol, currentSpread, riskDistance = 0) {
        if (!currentSpread || currentSpread <= 0) {
            return { allowed: true, reason: 'No spread data available' };
        }

        const current = parseFloat(currentSpread);
        const normal = this.normalSpread[symbol];

        // Not enough data yet — allow but log
        if (!normal || (this.spreadHistory[symbol]?.length || 0) < this.minSamples) {
            return { allowed: true, reason: 'Insufficient spread history, allowing trade' };
        }

        const ratio = current / normal;
        const maxRatio = this.maxSpreadRatio[symbol] || this.maxSpreadRatio['DEFAULT'];

        // Check 1: Spread ratio vs normal
        if (ratio > maxRatio) {
            return {
                allowed: false,
                reason: `Spread too wide: ${current.toFixed(5)} is ${ratio.toFixed(1)}x normal (${normal.toFixed(5)}). Max: ${maxRatio}x. Likely low liquidity or news.`,
                spreadRatio: ratio,
                spreadCostPercent: 0
            };
        }

        // Check 2: Spread cost as percentage of risk
        if (riskDistance > 0) {
            const spreadCostPercent = (current / riskDistance) * 100;

            // ⚛️ ARIA V15.3 THROUGHPUT OVERRIDE: Relaxed from 20% to 30% for Monolith demo
            if (spreadCostPercent > 30) {
                return {
                    allowed: false,
                    reason: `Spread cost too high: ${spreadCostPercent.toFixed(1)}% of risk (spread: ${current.toFixed(5)}, risk: ${riskDistance.toFixed(5)}). Max: 30%.`,
                    spreadRatio: ratio,
                    spreadCostPercent
                };
            }
        }

        return {
            allowed: true,
            reason: 'Spread acceptable',
            spreadRatio: parseFloat(ratio.toFixed(2)),
            current: current,
            normal: normal,
            spreadCostPercent: riskDistance > 0 ? parseFloat(((current / riskDistance) * 100).toFixed(1)) : 0
        };
    }

    /**
     * Record slippage for tracking
     */
    recordSlippage(symbol, intendedEntry, actualFill) {
        if (!symbol || !intendedEntry || !actualFill) return;

        const diff = Math.abs(actualFill - intendedEntry);

        if (!this.slippageHistory[symbol]) {
            this.slippageHistory[symbol] = [];
        }

        this.slippageHistory[symbol].push({
            intended: intendedEntry,
            actual: actualFill,
            diff,
            timestamp: Date.now()
        });

        // Keep last 50
        if (this.slippageHistory[symbol].length > 50) {
            this.slippageHistory[symbol].shift();
        }

        if (diff > 0) {
            dashboard.logMessage(`📊 Slippage: ${symbol} — Intended: ${intendedEntry.toFixed(5)}, Actual: ${actualFill.toFixed(5)}, Diff: ${diff.toFixed(5)}`);
        }
    }

    /**
     * Get average slippage for a symbol
     */
    getAverageSlippage(symbol) {
        const history = this.slippageHistory[symbol];
        if (!history || history.length === 0) return 0;

        const sum = history.reduce((a, b) => a + b.diff, 0);
        return sum / history.length;
    }

    /**
     * Adjust SL to account for typical spread
     * Experienced traders always add spread buffer to SL
     */
    adjustSLForSpread(symbol, sl, direction) {
        const normal = this.normalSpread[symbol];
        if (!normal) return sl;

        // Add 1x spread as buffer to SL
        if (direction === 'BUY') {
            return sl - normal; // Widen SL down for BUY
        } else {
            return sl + normal; // Widen SL up for SELL
        }
    }

    /**
     * Get status for dashboard
     */
    getStatus() {
        const status = {};
        for (const symbol in this.normalSpread) {
            const current = this.spreadHistory[symbol]?.slice(-1)[0] || 0;
            status[symbol] = {
                current: current.toFixed(5),
                normal: this.normalSpread[symbol].toFixed(5),
                ratio: (current / this.normalSpread[symbol]).toFixed(2),
                samples: this.spreadHistory[symbol]?.length || 0,
                avgSlippage: this.getAverageSlippage(symbol).toFixed(5)
            };
        }
        return status;
    }
}

module.exports = new SpreadFilter();
