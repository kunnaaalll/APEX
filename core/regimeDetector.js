/**
 * APEX Regime Detector
 * 
 * Classifies current market conditions to adapt trading strategy.
 * A 20-year trader instinctively adjusts for trending vs ranging markets.
 * 
 * Regimes:
 * - TRENDING: ADX > 25, clear BOS → trade continuations, wider TP
 * - RANGING: ADX < 20, no BOS → trade reversals at extremes, tight TP
 * - VOLATILE: ATR > 2x average → reduce risk 50%, widen SL
 * - LOW_VOLATILITY: ATR < 0.5x average → skip trading (spreads eat profits)
 * - BREAKOUT: Consolidation near key level → prepare for expansion
 */

const dashboard = require('../web/webDashboard');

class RegimeDetector {
    constructor() {
        // Cache regime per symbol
        this.regimeCache = {};
        this.atrHistory = {}; // Per-symbol ATR history for normalization
    }

    /**
     * Detect current market regime for a symbol
     * 
     * @param {string} symbol
     * @param {array} candles - At least 30 candles
     * @returns {object} { regime, adx, atrRatio, volatility, adjustments }
     */
    detect(symbol, candles) {
        if (!candles || candles.length < 20) {
            return { regime: 'UNKNOWN', adx: 0, atrRatio: 1, volatility: 'NORMAL', adjustments: {} };
        }

        const parsed = candles.map(c => ({
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
            open: parseFloat(c.open)
        }));

        // Calculate ADX
        const adx = this.calculateADX(parsed, 14);

        // Calculate ATR and its ratio to historical average
        const currentATR = this.calculateATR(parsed, 14);
        const avgATR = this.getAverageATR(symbol, currentATR);
        const atrRatio = avgATR > 0 ? currentATR / avgATR : 1;

        // Detect consolidation (for breakout detection)
        const consolidation = this.detectConsolidation(parsed);

        // Determine regime
        let regime = 'RANGING';
        let volatility = 'NORMAL';
        const adjustments = {
            riskMultiplier: 1.0,
            tpMultiplier: 1.0,
            slMultiplier: 1.0,
            minConfluence: 6,
            preferContinuation: false,
            preferReversal: false
        };

        // Volatility classification
        if (atrRatio > 2.0) {
            volatility = 'EXTREME';
            adjustments.riskMultiplier = 0.5;
            adjustments.slMultiplier = 1.5;
            adjustments.minConfluence = 8;
        } else if (atrRatio > 1.5) {
            volatility = 'HIGH';
            adjustments.riskMultiplier = 0.75;
            adjustments.slMultiplier = 1.25;
            adjustments.minConfluence = 7;
        } else if (atrRatio < 0.5) {
            volatility = 'VERY_LOW';
            adjustments.riskMultiplier = 0; // Don't trade in ultra-low vol
            adjustments.minConfluence = 10; // Effectively blocks trading
        } else if (atrRatio < 0.75) {
            volatility = 'LOW';
            adjustments.riskMultiplier = 0.75;
        }

        // Regime classification
        if (volatility === 'VERY_LOW') {
            regime = 'LOW_VOLATILITY';
        } else if (volatility === 'EXTREME') {
            regime = 'VOLATILE';
        } else if (consolidation.isConsolidating && adx < 20) {
            regime = 'BREAKOUT_PREP';
            adjustments.preferContinuation = true; // Be ready for expansion
        } else if (adx > 25) {
            regime = 'TRENDING';
            adjustments.tpMultiplier = 1.5; // Wider TPs in trends
            adjustments.preferContinuation = true;
            adjustments.minConfluence = 6; // Lower bar for trend trades
        } else if (adx < 20) {
            regime = 'RANGING';
            adjustments.tpMultiplier = 0.75; // Tighter TPs in ranges
            adjustments.preferReversal = true;
            adjustments.minConfluence = 7; // Higher bar for range trades
        } else {
            regime = 'TRANSITIONAL'; // ADX 20-25: market deciding
        }

        // Cache and track
        const prevRegime = this.regimeCache[symbol]?.regime;
        this.regimeCache[symbol] = { regime, adx, atrRatio, volatility, adjustments, timestamp: Date.now() };

        // Log regime changes
        if (prevRegime && prevRegime !== regime) {
            dashboard.logMessage(`🌐 Regime Change: ${symbol} ${prevRegime} → ${regime} (ADX: ${adx.toFixed(1)}, ATR ratio: ${atrRatio.toFixed(2)})`, 'info');
        }

        return { regime, adx, atrRatio, volatility, adjustments, consolidation };
    }

    /**
     * Calculate ADX (Average Directional Index)
     * Measures trend strength regardless of direction
     */
    calculateADX(candles, period = 14) {
        if (candles.length < period + 1) return 0;

        const len = candles.length;
        let sumDX = 0;
        let prevPlusDM = 0, prevMinusDM = 0, prevTR = 0;
        let count = 0;

        for (let i = 1; i < len; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevHigh = candles[i - 1].high;
            const prevLow = candles[i - 1].low;
            const prevClose = candles[i - 1].close;

            // True Range
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            // Directional Movement
            const upMove = high - prevHigh;
            const downMove = prevLow - low;

            let plusDM = 0, minusDM = 0;
            if (upMove > downMove && upMove > 0) plusDM = upMove;
            if (downMove > upMove && downMove > 0) minusDM = downMove;

            // Smoothed (Wilder's method simplified)
            const alpha = 1 / period;
            prevPlusDM = prevPlusDM * (1 - alpha) + plusDM * alpha;
            prevMinusDM = prevMinusDM * (1 - alpha) + minusDM * alpha;
            prevTR = prevTR * (1 - alpha) + tr * alpha;

            if (i >= period && prevTR > 0) {
                const plusDI = (prevPlusDM / prevTR) * 100;
                const minusDI = (prevMinusDM / prevTR) * 100;
                const diSum = plusDI + minusDI;
                const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
                sumDX += dx;
                count++;
            }
        }

        return count > 0 ? sumDX / count : 0;
    }

    /**
     * Calculate ATR
     */
    calculateATR(candles, period = 14) {
        if (candles.length < 2) return 0;

        const len = Math.min(period, candles.length - 1);
        let sumTR = 0;

        for (let i = candles.length - len; i < candles.length; i++) {
            const tr = Math.max(
                candles[i].high - candles[i].low,
                Math.abs(candles[i].high - candles[i - 1].close),
                Math.abs(candles[i].low - candles[i - 1].close)
            );
            sumTR += tr;
        }

        return sumTR / len;
    }

    /**
     * Track rolling average ATR for normalization
     */
    getAverageATR(symbol, currentATR) {
        if (!this.atrHistory[symbol]) {
            this.atrHistory[symbol] = [];
        }

        this.atrHistory[symbol].push(currentATR);

        // Keep last 100 readings
        if (this.atrHistory[symbol].length > 100) {
            this.atrHistory[symbol].shift();
        }

        const sum = this.atrHistory[symbol].reduce((a, b) => a + b, 0);
        return sum / this.atrHistory[symbol].length;
    }

    /**
     * Detect price consolidation (for breakout preparation)
     * Consolidation = declining ATR + price within tight range
     */
    detectConsolidation(candles) {
        const lookback = Math.min(10, candles.length);
        const recent = candles.slice(-lookback);

        let highOfRange = -Infinity;
        let lowOfRange = Infinity;

        for (const c of recent) {
            if (c.high > highOfRange) highOfRange = c.high;
            if (c.low < lowOfRange) lowOfRange = c.low;
        }

        const range = highOfRange - lowOfRange;
        const avgPrice = (highOfRange + lowOfRange) / 2;
        const rangePercent = (range / avgPrice) * 100;

        // ATR declining = price tightening
        const earlyATR = this.calculateATR(candles.slice(-20, -10), 5);
        const lateATR = this.calculateATR(candles.slice(-10), 5);
        const atrDeclining = lateATR > 0 && earlyATR > 0 && lateATR < earlyATR * 0.7;

        return {
            isConsolidating: rangePercent < 1.0 && atrDeclining,
            rangePercent: parseFloat(rangePercent.toFixed(3)),
            rangeHigh: highOfRange,
            rangeLow: lowOfRange,
            atrDeclining
        };
    }

    /**
     * Get regime for a symbol (cached)
     */
    getRegime(symbol) {
        return this.regimeCache[symbol] || { regime: 'UNKNOWN', adjustments: {} };
    }

    /**
     * Get context string for LLM prompt
     */
    getContextForLLM(symbol) {
        const regime = this.regimeCache[symbol];
        if (!regime) return '';

        return `\n=== MARKET REGIME ===
Regime: ${regime.regime}
ADX: ${regime.adx?.toFixed(1)} | Volatility: ${regime.volatility} | ATR Ratio: ${regime.atrRatio?.toFixed(2)}x
Strategy Adjustments: ${regime.regime === 'TRENDING' ? 'Trade continuations, wider TP targets' : 
    regime.regime === 'RANGING' ? 'Trade reversals at extremes, tight TP' :
    regime.regime === 'VOLATILE' ? 'Reduce risk 50%, widen SL, be selective' :
    regime.regime === 'LOW_VOLATILITY' ? 'SKIP — spreads eat profits' :
    regime.regime === 'BREAKOUT_PREP' ? 'Watch for expansion, prepare breakout trade' :
    'Market transitioning — be cautious'}
Min Confluence Required: ${regime.adjustments?.minConfluence || 6}/10\n`;
    }
}

module.exports = new RegimeDetector();
