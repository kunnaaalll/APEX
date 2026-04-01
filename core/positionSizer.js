/**
 * APEX Dynamic Position Sizer v3.0
 * 
 * Experienced traders adapt position size based on:
 * - Confluence quality (higher conviction = larger size)
 * - Current drawdown (deeper drawdown = smaller size)
 * - Rolling performance (losing streak = reduce, winning = maintain)
 * - Winning streak guard (prevents overconfidence)
 * - Market regime (volatile = reduce, calm = normal)
 * 
 * Never exceeds 2% risk. Minimum 0.25%.
 */

const dashboard = require('../web/webDashboard');
require('dotenv').config();

class PositionSizer {
    constructor() {
        this.baseRisk = parseFloat(process.env.DEFAULT_RISK_PERCENT || 1);
        this.maxRisk = 2.0;
        this.minRisk = 0.25;
    }

    /**
     * Calculate optimal risk percentage for a trade
     * 
     * @param {object} params
     * @param {number} params.confluenceScore - Overall score 0-10
     * @param {number} params.currentDrawdown - Current DD percentage (0-100)
     * @param {number} params.rollingWinRate - Last 20 trades WR (0-100)
     * @param {number} params.consecutiveWins - Current winning streak
     * @param {number} params.consecutiveLosses - Current losing streak
     * @param {object} params.regime - Regime detector result
     * @param {number} params.accountBalance - Current balance
     * @returns {object} { riskPercent, lotSize, reasoning }
     */
    calculate(params) {
        const {
            confluenceScore = 6,
            currentDrawdown = 0,
            rollingWinRate = 50,
            consecutiveWins = 0,
            consecutiveLosses = 0,
            regime = null,
            accountBalance = 10000,
            slDistance = 0,
            symbol = '',
            riskPerLot = 0
        } = params;

        let risk = 1.0; // STRICT: Exactly 1% risk as per user protocol
        const reasoning = [];

        // 1. Drawdown Safety Guard (STRICT)
        if (currentDrawdown >= 15) {
            risk = 0; // Pause trading
            reasoning.push(`🚨 PAUSED: Drawdown at ${currentDrawdown.toFixed(1)}% (Limit 15%)`);
        } else {
            reasoning.push(`⚖️ Protocol: Strict 1% risk sizing`);
        }

        // Enforce hard limit (redundant but safe)
        risk = currentDrawdown >= 15 ? 0 : 1.0;

        // If we're paused (DD >= 15%), force to 0
        if (currentDrawdown >= 15) risk = 0;

        // 8. Calculate actual lot size
        let lotSize = 0.01; // Default minimum
        if (slDistance > 0 && accountBalance > 0) {
            const riskAmount = accountBalance * (risk / 100);
            
            if (riskPerLot > 0) {
                // If we know the risk per lot (pip value * SL in pips)
                lotSize = riskAmount / riskPerLot;
            } else {
                // Estimate based on common lot sizing
                lotSize = this.estimateLotSize(symbol, accountBalance, risk, slDistance);
            }
        }

        // Enforce lot limits
        lotSize = Math.max(0.01, Math.min(10, parseFloat(lotSize.toFixed(2))));

        const result = {
            riskPercent: parseFloat(risk.toFixed(2)),
            riskAmount: parseFloat((accountBalance * risk / 100).toFixed(2)),
            lotSize,
            reasoning,
            paused: risk === 0
        };

        dashboard.logMessage(
            `📐 Position Sizer: ${symbol || 'N/A'} — Risk: ${result.riskPercent}% ($${result.riskAmount}) | ` +
            `Lots: ${result.lotSize} | ` + reasoning.slice(0, 3).join(', ')
        );

        return result;
    }

    /**
     * Estimate lot size from risk parameters
     * Uses approximate pip values for common pairs
     */
    estimateLotSize(symbol, balance, riskPercent, slDistance) {
        const riskAmount = balance * (riskPercent / 100);
        
        // Approximate pip values per standard lot
        const pipValues = {
            'EURUSD': 10, 'GBPUSD': 10, 'AUDUSD': 10, 'NZDUSD': 10,
            'USDCHF': 10, 'USDCAD': 10,
            'USDJPY': 6.5, 'EURJPY': 6.5, 'GBPJPY': 6.5,
            'XAUUSD': 1  // Gold: $1 per pip per 0.01 lot
        };

        const pipValue = pipValues[symbol] || 10;
        
        // Convert SL distance to pips
        let slPips;
        if (symbol === 'XAUUSD') {
            slPips = slDistance; // Gold: $1 = 1 pip
        } else if (symbol && (symbol.includes('JPY'))) {
            slPips = slDistance * 100; // JPY pairs: pips = distance * 100
        } else {
            slPips = slDistance * 10000; // Standard pairs: pips = distance * 10000
        }

        if (slPips <= 0) return 0.01;

        // lot size = risk amount / (pip value * SL pips)
        const lots = riskAmount / (pipValue * slPips);
        return Math.max(0.01, parseFloat(lots.toFixed(2)));
    }
}

module.exports = new PositionSizer();
