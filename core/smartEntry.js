/**
 * APEX Smart Entry Engine v3.0
 * 
 * A 20-year trader doesn't chase entries. They wait for price to come to them.
 * 
 * Instead of MARKET orders, this engine:
 * 1. Identifies optimal entry price (OB zone, FVG, OTE)
 * 2. Places LIMIT orders at the POI
 * 3. Sets order expiry (max 2 hours wait)
 * 4. Cancels orders if market structure changes
 * 5. Falls back to MARKET entry only for displacement setups
 * 
 * This dramatically improves:
 * - Fill quality (better entry price)
 * - Risk:Reward ratio (tighter SL possible)
 * - Win rate (price respects POI before moving)
 */

const dashboard = require('../web/webDashboard');
const server = require('./server');

class SmartEntry {
    constructor() {
        // Pending limit orders tracked locally
        this.pendingLimits = {}; // symbol -> { type, price, sl, tp, expiry, ticket? }
        
        // Settings
        this.maxWaitTime = 2 * 60 * 60 * 1000; // 2 hours max wait for limit fill
        this.useMarketForDisplacement = true;    // Exception: use market for displacement entries
    }

    /**
     * Determine optimal entry method and price
     * 
     * @param {string} symbol 
     * @param {object} setup - The AI/detector setup recommendation
     * @param {object} zones - SMC zones from detector
     * @returns {object} { entryType, entryPrice, adjustedSL, adjustedTP, reasoning }
     */
    calculateEntry(symbol, setup, zones) {
        const direction = setup.direction;
        const currentPrice = parseFloat(setup.entry || setup.currentPrice);
        const atr = parseFloat(setup.atr || 0);

        // 1. Check for displacement (rare — use MARKET immediately)
        if (this.useMarketForDisplacement && zones?.displacement?.length > 0) {
            const lastDisp = zones.displacement[zones.displacement.length - 1];
            if ((direction === 'BUY' && lastDisp.type === 'bullish') ||
                (direction === 'SELL' && lastDisp.type === 'bearish')) {
                return {
                    entryType: 'MARKET',
                    entryPrice: currentPrice,
                    adjustedSL: setup.sl,
                    adjustedTP: setup.tp,
                    reasoning: 'Displacement detected — enter immediately before momentum moves price away'
                };
            }
        }

        // 2. Try OTE entry (best — Fib 0.618-0.786 zone)
        if (zones?.ote && !zones.ote.inOTE) {
            const oteEntry = this.calculateOTEEntry(direction, zones.ote, currentPrice, setup, atr);
            if (oteEntry) return oteEntry;
        }

        // 3. Try Order Block entry
        if (zones?.ob?.length > 0) {
            const obEntry = this.calculateOBEntry(direction, zones.ob, currentPrice, setup, atr);
            if (obEntry) return obEntry;
        }

        // 4. Try Fair Value Gap entry
        if (zones?.fvg?.length > 0) {
            const fvgEntry = this.calculateFVGEntry(direction, zones.fvg, currentPrice, setup, atr);
            if (fvgEntry) return fvgEntry;
        }

        // 5. Fallback: Market entry at current price
        return {
            entryType: 'MARKET',
            entryPrice: currentPrice,
            adjustedSL: setup.sl,
            adjustedTP: setup.tp,
            reasoning: 'No POI found for limit entry — using market order'
        };
    }

    /**
     * OTE Entry — enter at Fib 0.618-0.786 pullback zone
     */
    calculateOTEEntry(direction, ote, currentPrice, setup, atr) {
        if (!ote || !ote.oteZone) return null;

        const midOTE = (ote.oteZone.top + ote.oteZone.bottom) / 2;

        if (direction === 'BUY' && ote.trend === 'BULLISH') {
            // Price should be above OTE, limit buy below at OTE
            if (currentPrice > midOTE) {
                const entryPrice = midOTE;
                const distToOTE = Math.abs(currentPrice - entryPrice);

                // Only if OTE isn't too far (max 1.5 ATR away)
                if (atr > 0 && distToOTE > atr * 1.5) return null;

                // Tighter SL possible since we're buying lower
                const newSL = ote.oteZone.bottom - (atr * 0.3);

                return {
                    entryType: 'BUY_LIMIT',
                    entryPrice: parseFloat(entryPrice.toFixed(5)),
                    adjustedSL: parseFloat(newSL.toFixed(5)),
                    adjustedTP: setup.tp,
                    reasoning: `OTE limit buy at Fib 0.618-0.786 zone (${entryPrice.toFixed(5)}). Better fill than market (${currentPrice.toFixed(5)}).`
                };
            }
        }

        if (direction === 'SELL' && ote.trend === 'BEARISH') {
            if (currentPrice < midOTE) {
                const entryPrice = midOTE;
                const distToOTE = Math.abs(currentPrice - entryPrice);

                if (atr > 0 && distToOTE > atr * 1.5) return null;

                const newSL = ote.oteZone.top + (atr * 0.3);

                return {
                    entryType: 'SELL_LIMIT',
                    entryPrice: parseFloat(entryPrice.toFixed(5)),
                    adjustedSL: parseFloat(newSL.toFixed(5)),
                    adjustedTP: setup.tp,
                    reasoning: `OTE limit sell at Fib zone (${entryPrice.toFixed(5)}). Better fill than market (${currentPrice.toFixed(5)}).`
                };
            }
        }

        return null;
    }

    /**
     * Order Block Entry — enter at unmitigated OB zone
     */
    calculateOBEntry(direction, obs, currentPrice, setup, atr) {
        // Find entry-relevant OB
        const relevantOB = direction === 'BUY'
            ? obs.filter(ob => ob.type === 'bullish' && !ob.mitigated).pop()
            : obs.filter(ob => ob.type === 'bearish' && !ob.mitigated).pop();

        if (!relevantOB) return null;

        if (direction === 'BUY') {
            // Limit buy at OB high (top of the bullish OB zone)
            const entryPrice = relevantOB.high;
            if (entryPrice >= currentPrice) return null; // OB is above us — doesn't help

            const distance = currentPrice - entryPrice;
            if (atr > 0 && distance > atr * 2) return null; // Too far

            const newSL = relevantOB.low - (atr * 0.15);

            return {
                entryType: 'BUY_LIMIT',
                entryPrice: parseFloat(entryPrice.toFixed(5)),
                adjustedSL: parseFloat(newSL.toFixed(5)),
                adjustedTP: setup.tp,
                reasoning: `OB limit buy at bullish OB zone (${entryPrice.toFixed(5)}). SL below OB low (${newSL.toFixed(5)}).`
            };
        }

        if (direction === 'SELL') {
            const entryPrice = relevantOB.low;
            if (entryPrice <= currentPrice) return null;

            const distance = entryPrice - currentPrice;
            if (atr > 0 && distance > atr * 2) return null;

            const newSL = relevantOB.high + (atr * 0.15);

            return {
                entryType: 'SELL_LIMIT',
                entryPrice: parseFloat(entryPrice.toFixed(5)),
                adjustedSL: parseFloat(newSL.toFixed(5)),
                adjustedTP: setup.tp,
                reasoning: `OB limit sell at bearish OB zone (${entryPrice.toFixed(5)}). SL above OB high (${newSL.toFixed(5)}).`
            };
        }

        return null;
    }

    /**
     * FVG Entry — enter at Fair Value Gap zone
     */
    calculateFVGEntry(direction, fvgs, currentPrice, setup, atr) {
        const relevantFVG = direction === 'BUY'
            ? fvgs.filter(f => f.type === 'bullish').pop()
            : fvgs.filter(f => f.type === 'bearish').pop();

        if (!relevantFVG) return null;

        if (direction === 'BUY') {
            const entryPrice = relevantFVG.top; // Buy at top of bullish FVG
            if (entryPrice >= currentPrice) return null;

            const distance = currentPrice - entryPrice;
            if (atr > 0 && distance > atr * 1.5) return null;

            return {
                entryType: 'BUY_LIMIT',
                entryPrice: parseFloat(entryPrice.toFixed(5)),
                adjustedSL: setup.sl,
                adjustedTP: setup.tp,
                reasoning: `FVG limit buy at bullish gap fill (${entryPrice.toFixed(5)}).`
            };
        }

        if (direction === 'SELL') {
            const entryPrice = relevantFVG.bottom;
            if (entryPrice <= currentPrice) return null;

            const distance = entryPrice - currentPrice;
            if (atr > 0 && distance > atr * 1.5) return null;

            return {
                entryType: 'SELL_LIMIT',
                entryPrice: parseFloat(entryPrice.toFixed(5)),
                adjustedSL: setup.sl,
                adjustedTP: setup.tp,
                reasoning: `FVG limit sell at bearish gap fill (${entryPrice.toFixed(5)}).`
            };
        }

        return null;
    }

    /**
     * Place a limit order on the bridge
     */
    placeLimitOrder(symbol, entryResult) {
        const command = {
            symbol: symbol,
            type: entryResult.entryType, // BUY_LIMIT or SELL_LIMIT
            direction: entryResult.entryType.includes('BUY') ? 'BUY' : 'SELL',
            price: entryResult.entryPrice,
            sl: entryResult.adjustedSL,
            tp: entryResult.adjustedTP,
            expiry: Date.now() + this.maxWaitTime
        };

        server.pendingOrders.push(command);

        this.pendingLimits[symbol] = {
            ...command,
            placedAt: Date.now(),
            reasoning: entryResult.reasoning
        };

        dashboard.logMessage(
            `📌 LIMIT ORDER: ${symbol} ${entryResult.entryType} @ ${entryResult.entryPrice.toFixed(5)} | ` +
            `SL=${entryResult.adjustedSL.toFixed(5)} TP=${entryResult.adjustedTP} | ` +
            `${entryResult.reasoning}`,
            'info'
        );
    }

    /**
     * Check and cancel expired limit orders
     * Called periodically from apex.js
     */
    checkExpiredOrders() {
        const now = Date.now();

        for (const symbol in this.pendingLimits) {
            const order = this.pendingLimits[symbol];
            if (now > order.expiry) {
                // Cancel the order
                server.pendingOrders.push({
                    symbol: symbol,
                    type: 'CANCEL_PENDING',
                    direction: order.direction
                });

                dashboard.logMessage(`⏰ EXPIRED: ${symbol} limit order cancelled after 2 hours.`, 'info');
                delete this.pendingLimits[symbol];
            }
        }
    }

    /**
     * Cancel limit order due to structure change
     */
    cancelOnStructureBreak(symbol) {
        if (this.pendingLimits[symbol]) {
            server.pendingOrders.push({
                symbol: symbol,
                type: 'CANCEL_PENDING',
                direction: this.pendingLimits[symbol].direction
            });

            dashboard.logMessage(`🚫 CANCELLED: ${symbol} limit order — market structure changed.`, 'warn');
            delete this.pendingLimits[symbol];
        }
    }

    /**
     * Get status of all pending limits
     */
    getStatus() {
        return { ...this.pendingLimits };
    }
}

module.exports = new SmartEntry();
