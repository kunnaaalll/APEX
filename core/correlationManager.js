/**
 * APEX Correlation Manager v3.0
 * 
 * Experienced traders know: correlated pairs = doubled risk.
 * 
 * If you're long EURUSD and long GBPUSD, you have 2x exposure to USD weakness.
 * A 20-year trader would never let this happen unconsciously.
 * 
 * Features:
 * - Blocks new trades that create excessive correlation exposure
 * - Tracks active exposure per currency
 * - Warns when approaching concentration limits
 * - USD, EUR, GBP, JPY, AUD, CHF, CAD, NZD, XAU tracking
 */

const dashboard = require('../web/webDashboard');

class CorrelationManager {
    constructor() {
        // Maximum exposure per currency (number of active positions affecting that currency)
        this.maxCurrencyExposure = 2;
        
        // Maximum correlated trades (same direction on highly correlated pairs)
        this.maxCorrelatedTrades = 2;

        // Correlation groups — pairs that move together
        this.correlationGroups = {
            'USD_WEAKNESS': ['EURUSD_BUY', 'GBPUSD_BUY', 'AUDUSD_BUY', 'NZDUSD_BUY'],
            'USD_STRENGTH': ['EURUSD_SELL', 'GBPUSD_SELL', 'AUDUSD_SELL', 'NZDUSD_SELL', 'USDJPY_BUY', 'USDCHF_BUY', 'USDCAD_BUY'],
            'RISK_ON': ['AUDUSD_BUY', 'NZDUSD_BUY', 'USDJPY_BUY', 'XAUUSD_SELL'],
            'RISK_OFF': ['USDJPY_SELL', 'USDCHF_SELL', 'XAUUSD_BUY'],
            'EUR_PAIRS': ['EURUSD_BUY', 'EURUSD_SELL', 'EURJPY_BUY', 'EURJPY_SELL'],
            'GBP_PAIRS': ['GBPUSD_BUY', 'GBPUSD_SELL', 'GBPJPY_BUY', 'GBPJPY_SELL']
        };

        // Currency decomposition — which currencies are affected by each pair
        this.currencyMap = {
            'EURUSD': { base: 'EUR', quote: 'USD' },
            'GBPUSD': { base: 'GBP', quote: 'USD' },
            'USDJPY': { base: 'USD', quote: 'JPY' },
            'USDCHF': { base: 'USD', quote: 'CHF' },
            'USDCAD': { base: 'USD', quote: 'CAD' },
            'AUDUSD': { base: 'AUD', quote: 'USD' },
            'NZDUSD': { base: 'NZD', quote: 'USD' },
            'EURJPY': { base: 'EUR', quote: 'JPY' },
            'GBPJPY': { base: 'GBP', quote: 'JPY' },
            'EURGBP': { base: 'EUR', quote: 'GBP' },
            'XAUUSD': { base: 'XAU', quote: 'USD' }
        };

        // Active positions tracking
        this.activePositions = []; // [{ symbol, direction, ticket }]
    }

    /**
     * Update active positions from position data
     */
    updatePositions(positions) {
        this.activePositions = (positions || []).map(p => ({
            symbol: p.symbol,
            direction: p.type === 0 ? 'BUY' : 'SELL',
            ticket: p.ticket,
            profit: p.profit || 0
        }));
    }

    /**
     * MAIN CHECK: Can we take a new trade given current exposure?
     * 
     * @param {string} symbol - e.g., 'EURUSD'
     * @param {string} direction - 'BUY' or 'SELL'
     * @returns {object} { allowed, reason, exposure }
     */
    canTrade(symbol, direction) {
        if (this.activePositions.length === 0) {
            return { allowed: true, reason: 'No active positions' };
        }

        // 1. Check currency exposure
        const exposureCheck = this.checkCurrencyExposure(symbol, direction);
        if (!exposureCheck.allowed) {
            return exposureCheck;
        }

        // 2. Check correlation group conflicts
        const correlationCheck = this.checkCorrelationGroups(symbol, direction);
        if (!correlationCheck.allowed) {
            return correlationCheck;
        }

        // 3. Check for direct hedging (opposite direction on same pair)
        const hedgeCheck = this.checkHedging(symbol, direction);
        if (!hedgeCheck.allowed) {
            return hedgeCheck;
        }

        return { 
            allowed: true, 
            reason: 'Correlation check passed',
            exposure: this.getCurrentExposure()
        };
    }

    /**
     * Check if adding this trade creates too much exposure to any single currency
     */
    checkCurrencyExposure(symbol, direction) {
        const currencies = this.currencyMap[symbol];
        if (!currencies) {
            return { allowed: true, reason: 'Unknown pair — skipping correlation check' };
        }

        // Calculate current exposure per currency
        const exposure = this.getCurrentExposure();

        // Determine which currencies get MORE exposed
        // BUY EURUSD = LONG EUR, SHORT USD
        // SELL EURUSD = SHORT EUR, LONG USD
        const longCurrency = direction === 'BUY' ? currencies.base : currencies.quote;
        const shortCurrency = direction === 'BUY' ? currencies.quote : currencies.base;

        const longExposure = (exposure.long[longCurrency] || 0) + 1;
        const shortExposure = (exposure.short[shortCurrency] || 0) + 1;

        if (longExposure > this.maxCurrencyExposure) {
            return {
                allowed: false,
                reason: `Currency overexposure: ${longCurrency} would have ${longExposure} long positions (max: ${this.maxCurrencyExposure})`,
                exposure
            };
        }

        if (shortExposure > this.maxCurrencyExposure) {
            return {
                allowed: false,
                reason: `Currency overexposure: ${shortCurrency} would have ${shortExposure} short positions (max: ${this.maxCurrencyExposure})`,
                exposure
            };
        }

        return { allowed: true };
    }

    /**
     * Check if trade conflicts with correlation groups
     */
    checkCorrelationGroups(symbol, direction) {
        const tradeKey = `${symbol}_${direction}`;

        for (const [groupName, groupPairs] of Object.entries(this.correlationGroups)) {
            if (!groupPairs.includes(tradeKey)) continue;

            // Count how many active positions are in this group
            let groupCount = 0;
            for (const pos of this.activePositions) {
                const posKey = `${pos.symbol}_${pos.direction}`;
                if (groupPairs.includes(posKey)) {
                    groupCount++;
                }
            }

            if (groupCount >= this.maxCorrelatedTrades) {
                return {
                    allowed: false,
                    reason: `Correlation limit: ${groupName} group already has ${groupCount} positions (max: ${this.maxCorrelatedTrades}). Adding ${tradeKey} would create excessive correlated exposure.`
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Check for direct hedging — opposite direction on same pair
     */
    checkHedging(symbol, direction) {
        const hedge = this.activePositions.find(p => 
            p.symbol === symbol && p.direction !== direction
        );

        if (hedge) {
            return {
                allowed: false,
                reason: `Hedging blocked: Already have ${hedge.direction} on ${symbol} (#${hedge.ticket}). Cannot take opposite direction.`
            };
        }

        return { allowed: true };
    }

    /**
     * Get current exposure breakdown by currency
     */
    getCurrentExposure() {
        const long = {};   // Currency -> count of long positions
        const short = {};  // Currency -> count of short positions

        for (const pos of this.activePositions) {
            const currencies = this.currencyMap[pos.symbol];
            if (!currencies) continue;

            if (pos.direction === 'BUY') {
                long[currencies.base] = (long[currencies.base] || 0) + 1;
                short[currencies.quote] = (short[currencies.quote] || 0) + 1;
            } else {
                short[currencies.base] = (short[currencies.base] || 0) + 1;
                long[currencies.quote] = (long[currencies.quote] || 0) + 1;
            }
        }

        return { long, short, totalPositions: this.activePositions.length };
    }

    /**
     * Get context for LLM prompt
     */
    getContextForLLM() {
        const exposure = this.getCurrentExposure();
        if (exposure.totalPositions === 0) return '';

        let context = '\n=== CORRELATION EXPOSURE ===\n';
        context += `Active Positions: ${exposure.totalPositions}\n`;
        
        if (Object.keys(exposure.long).length > 0) {
            context += `Long Exposure: ${Object.entries(exposure.long).map(([c, n]) => `${c}(${n})`).join(', ')}\n`;
        }
        if (Object.keys(exposure.short).length > 0) {
            context += `Short Exposure: ${Object.entries(exposure.short).map(([c, n]) => `${c}(${n})`).join(', ')}\n`;
        }

        return context;
    }

    /**
     * Get status for dashboard
     */
    getStatus() {
        return {
            activePositions: this.activePositions.length,
            exposure: this.getCurrentExposure(),
            maxCurrencyExposure: this.maxCurrencyExposure,
            maxCorrelatedTrades: this.maxCorrelatedTrades
        };
    }
}

module.exports = new CorrelationManager();
