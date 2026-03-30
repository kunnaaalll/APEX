/**
 * APEX SMC (Smart Money Concepts) Engine v2.0
 * 
 * Full implementation of institutional trading concepts:
 * - Order Blocks (OB)
 * - Fair Value Gaps (FVG)
 * - Break of Structure (BOS)
 * - Change of Character (CHoCH)
 * - Liquidity Sweeps
 * - Breaker Blocks
 * - Premium/Discount Zones
 * - Killzone Detection
 */

class SMCDetector {
    constructor() {
        this.structureCache = {};
    }

    detectZones(candles) {
        if (!candles || candles.length < 5) {
            return { ob: [], fvg: [], liquidity: {}, structure: {}, premium_discount: {}, killzone: null, breakers: [] };
        }

        const parsed = candles.map(c => ({
            time: c.time,
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
            volume: parseFloat(c.volume || 0)
        }));

        return {
            ob: this.findOrderBlocks(parsed),
            fvg: this.findFairValueGaps(parsed),
            liquidity: this.findLiquidity(parsed),
            structure: this.analyzeStructure(parsed),
            premium_discount: this.findPremiumDiscount(parsed),
            killzone: this.detectKillzone(),
            breakers: this.findBreakerBlocks(parsed)
        };
    }

    /**
     * Order Block Detection
     * Bullish OB: Last bearish candle before a strong bullish impulse that breaks structure
     * Bearish OB: Last bullish candle before a strong bearish impulse that breaks structure
     */
    findOrderBlocks(candles) {
        const obs = [];
        if (candles.length < 3) return obs;

        for (let i = 1; i < candles.length - 1; i++) {
            const prev = candles[i - 1];
            const current = candles[i];
            const next = candles[i + 1];

            const currentBody = Math.abs(current.close - current.open);
            const nextBody = Math.abs(next.close - next.open);
            const currentRange = current.high - current.low;
            const nextRange = next.high - next.low;

            // Bullish OB: bearish candle followed by strong bullish candle
            if (current.close < current.open && next.close > next.open) {
                const impulseStrength = nextBody / (currentBody || 0.0001);
                // Impulse must be at least 1.5x the OB candle body
                if (impulseStrength >= 1.5 && nextBody > 0) {
                    // Verify it breaks above the OB high (structural confirmation)
                    const breaksAbove = next.close > current.high;
                    obs.push({
                        type: 'bullish',
                        high: current.high,
                        low: current.low,
                        open: current.open,
                        close: current.close,
                        time: current.time,
                        strength: Math.min(impulseStrength, 5).toFixed(2),
                        confirmed: breaksAbove,
                        mitigated: false
                    });
                }
            }

            // Bearish OB: bullish candle followed by strong bearish candle
            if (current.close > current.open && next.close < next.open) {
                const impulseStrength = nextBody / (currentBody || 0.0001);
                if (impulseStrength >= 1.5 && nextBody > 0) {
                    const breaksBelow = next.close < current.low;
                    obs.push({
                        type: 'bearish',
                        high: current.high,
                        low: current.low,
                        open: current.open,
                        close: current.close,
                        time: current.time,
                        strength: Math.min(impulseStrength, 5).toFixed(2),
                        confirmed: breaksBelow,
                        mitigated: false
                    });
                }
            }
        }

        // Check if OBs have been mitigated (price returned and traded through)
        const lastPrice = candles[candles.length - 1].close;
        for (const ob of obs) {
            if (ob.type === 'bullish' && lastPrice < ob.low) {
                ob.mitigated = true;
            }
            if (ob.type === 'bearish' && lastPrice > ob.high) {
                ob.mitigated = true;
            }
        }

        // Return only un-mitigated, most recent OBs
        return obs.filter(ob => !ob.mitigated).slice(-5);
    }

    /**
     * Fair Value Gap Detection
     * Bullish FVG: Gap between candle 1's high and candle 3's low (candle 2 created the gap)
     * Bearish FVG: Gap between candle 1's low and candle 3's high
     */
    findFairValueGaps(candles) {
        const fvgs = [];
        if (candles.length < 3) return fvgs;

        for (let i = 0; i < candles.length - 2; i++) {
            const first = candles[i];
            const second = candles[i + 1];
            const third = candles[i + 2];

            // Bullish FVG: third candle's low is above first candle's high
            if (third.low > first.high) {
                const gapSize = third.low - first.high;
                const avgRange = (first.high - first.low + second.high - second.low + third.high - third.low) / 3;

                fvgs.push({
                    type: 'bullish',
                    top: third.low,
                    bottom: first.high,
                    midpoint: (third.low + first.high) / 2,
                    size: gapSize,
                    significant: gapSize > avgRange * 0.5,
                    time: second.time,
                    filled: false
                });
            }

            // Bearish FVG: third candle's high is below first candle's low
            if (third.high < first.low) {
                const gapSize = first.low - third.high;
                const avgRange = (first.high - first.low + second.high - second.low + third.high - third.low) / 3;

                fvgs.push({
                    type: 'bearish',
                    top: first.low,
                    bottom: third.high,
                    midpoint: (first.low + third.high) / 2,
                    size: gapSize,
                    significant: gapSize > avgRange * 0.5,
                    time: second.time,
                    filled: false
                });
            }
        }

        // Check if FVGs have been filled by subsequent price action
        const lastPrice = candles[candles.length - 1].close;
        for (const fvg of fvgs) {
            if (fvg.type === 'bullish' && lastPrice < fvg.bottom) {
                fvg.filled = true;
            }
            if (fvg.type === 'bearish' && lastPrice > fvg.top) {
                fvg.filled = true;
            }
        }

        // Return only unfilled, significant FVGs
        return fvgs.filter(f => !f.filled && f.significant).slice(-5);
    }

    /**
     * Break of Structure (BOS) & Change of Character (CHoCH)
     * 
     * BOS: Price breaks a swing high (bullish) or swing low (bearish) IN the direction of trend → continuation
     * CHoCH: Price breaks a swing high/low AGAINST the trend → reversal signal
     */
    analyzeStructure(candles) {
        if (candles.length < 10) {
            return { bos: false, choch: false, trend: 'RANGING', swingHighs: [], swingLows: [], lastBOS: null, lastCHoCH: null };
        }

        const swingHighs = [];
        const swingLows = [];

        // Find swing points (using 3-bar pivot)
        for (let i = 2; i < candles.length - 2; i++) {
            const isSwingHigh = candles[i].high > candles[i - 1].high &&
                                candles[i].high > candles[i - 2].high &&
                                candles[i].high > candles[i + 1].high &&
                                candles[i].high > candles[i + 2].high;

            const isSwingLow = candles[i].low < candles[i - 1].low &&
                               candles[i].low < candles[i - 2].low &&
                               candles[i].low < candles[i + 1].low &&
                               candles[i].low < candles[i + 2].low;

            if (isSwingHigh) swingHighs.push({ price: candles[i].high, index: i, time: candles[i].time });
            if (isSwingLow) swingLows.push({ price: candles[i].low, index: i, time: candles[i].time });
        }

        // Determine trend from swing structure
        let trend = 'RANGING';
        let bos = false;
        let choch = false;
        let lastBOS = null;
        let lastCHoCH = null;

        if (swingHighs.length >= 2 && swingLows.length >= 2) {
            const lastSH = swingHighs[swingHighs.length - 1];
            const prevSH = swingHighs[swingHighs.length - 2];
            const lastSL = swingLows[swingLows.length - 1];
            const prevSL = swingLows[swingLows.length - 2];

            // Higher highs and higher lows = BULLISH
            const higherHighs = lastSH.price > prevSH.price;
            const higherLows = lastSL.price > prevSL.price;
            // Lower highs and lower lows = BEARISH
            const lowerHighs = lastSH.price < prevSH.price;
            const lowerLows = lastSL.price < prevSL.price;

            if (higherHighs && higherLows) trend = 'BULLISH';
            else if (lowerHighs && lowerLows) trend = 'BEARISH';

            const lastClose = candles[candles.length - 1].close;

            // BOS detection (trend continuation)
            if (trend === 'BULLISH' && lastClose > lastSH.price) {
                bos = true;
                lastBOS = { type: 'bullish', level: lastSH.price, time: lastSH.time };
            }
            if (trend === 'BEARISH' && lastClose < lastSL.price) {
                bos = true;
                lastBOS = { type: 'bearish', level: lastSL.price, time: lastSL.time };
            }

            // CHoCH detection (trend reversal)
            if (trend === 'BULLISH' && lastClose < prevSL.price) {
                choch = true;
                lastCHoCH = { type: 'bearish_reversal', level: prevSL.price, time: prevSL.time };
            }
            if (trend === 'BEARISH' && lastClose > prevSH.price) {
                choch = true;
                lastCHoCH = { type: 'bullish_reversal', level: prevSH.price, time: prevSH.time };
            }
        }

        return {
            bos,
            choch,
            trend,
            swingHighs: swingHighs.slice(-5),
            swingLows: swingLows.slice(-5),
            lastBOS,
            lastCHoCH
        };
    }

    /**
     * Liquidity Detection
     * 
     * Equal highs/lows = Liquidity pools (stop losses clustered)
     * Sweep: Price quickly moves through and reverses (stop hunt)
     */
    findLiquidity(candles) {
        if (candles.length < 10) return { pools: [], sweeps: [], swing_high: 0, swing_low: Infinity };

        const tolerance = 0.0005; // Adjust per asset (will be dynamic)
        const pools = [];
        const sweeps = [];

        // Find equal highs (sell-side liquidity)
        for (let i = 0; i < candles.length - 1; i++) {
            for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
                const diff = Math.abs(candles[i].high - candles[j].high);
                const avgPrice = (candles[i].high + candles[j].high) / 2;
                const relDiff = diff / avgPrice;

                if (relDiff < tolerance) {
                    pools.push({
                        type: 'sell_side',
                        level: (candles[i].high + candles[j].high) / 2,
                        touches: 2,
                        time: candles[j].time
                    });
                }
            }
        }

        // Find equal lows (buy-side liquidity)
        for (let i = 0; i < candles.length - 1; i++) {
            for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
                const diff = Math.abs(candles[i].low - candles[j].low);
                const avgPrice = (candles[i].low + candles[j].low) / 2;
                const relDiff = diff / avgPrice;

                if (relDiff < tolerance) {
                    pools.push({
                        type: 'buy_side',
                        level: (candles[i].low + candles[j].low) / 2,
                        touches: 2,
                        time: candles[j].time
                    });
                }
            }
        }

        // Detect liquidity sweeps (wick through level then close back)
        const lastCandle = candles[candles.length - 1];
        const prevCandle = candles[candles.length - 2];

        for (const pool of pools) {
            if (pool.type === 'sell_side') {
                // Price wicked above but closed below = sweep
                if (lastCandle.high > pool.level && lastCandle.close < pool.level) {
                    sweeps.push({ type: 'bullish_sweep', level: pool.level, time: lastCandle.time });
                }
            }
            if (pool.type === 'buy_side') {
                // Price wicked below but closed above = sweep
                if (lastCandle.low < pool.level && lastCandle.close > pool.level) {
                    sweeps.push({ type: 'bearish_sweep', level: pool.level, time: lastCandle.time });
                }
            }
        }

        // Overall swing high/low
        let swingHigh = -Infinity;
        let swingLow = Infinity;
        const recent = candles.slice(-20);
        for (const c of recent) {
            if (c.high > swingHigh) swingHigh = c.high;
            if (c.low < swingLow) swingLow = c.low;
        }

        return {
            pools: pools.slice(-10),
            sweeps,
            swing_high: swingHigh,
            swing_low: swingLow
        };
    }

    /**
     * Premium/Discount Zone Detection
     * 
     * Uses the current swing range to determine Fibonacci 0.5 equilibrium.
     * BUY only in discount (below 0.5), SELL only in premium (above 0.5)
     */
    findPremiumDiscount(candles) {
        if (candles.length < 10) return { zone: 'EQUILIBRIUM', equilibrium: 0, premium: 0, discount: 0 };

        const recent = candles.slice(-20);
        let high = -Infinity;
        let low = Infinity;

        for (const c of recent) {
            if (c.high > high) high = c.high;
            if (c.low < low) low = c.low;
        }

        const equilibrium = (high + low) / 2;
        const currentPrice = candles[candles.length - 1].close;
        const range = high - low;

        let zone = 'EQUILIBRIUM';
        const position = (currentPrice - low) / (range || 1);

        if (position > 0.618) zone = 'PREMIUM';
        else if (position < 0.382) zone = 'DISCOUNT';
        else zone = 'EQUILIBRIUM';

        return {
            zone,
            position: parseFloat(position.toFixed(3)),
            equilibrium: parseFloat(equilibrium.toFixed(5)),
            premium: parseFloat((low + range * 0.618).toFixed(5)),
            discount: parseFloat((low + range * 0.382).toFixed(5)),
            rangeHigh: high,
            rangeLow: low
        };
    }

    /**
     * Killzone Detection
     * London: 07:00 - 09:00 UTC
     * NY: 13:00 - 15:00 UTC  
     * Asian: 00:00 - 03:00 UTC
     * London/NY Overlap: 13:00 - 16:00 UTC (highest volume)
     */
    detectKillzone() {
        const now = new Date();
        const utcHour = now.getUTCHours();

        if (utcHour >= 7 && utcHour < 9) return { session: 'LONDON_OPEN', quality: 'HIGH', description: 'London Open Killzone' };
        if (utcHour >= 9 && utcHour < 12) return { session: 'LONDON', quality: 'MEDIUM', description: 'London Session' };
        if (utcHour >= 13 && utcHour < 16) return { session: 'NY_OVERLAP', quality: 'HIGHEST', description: 'London/NY Overlap' };
        if (utcHour >= 16 && utcHour < 20) return { session: 'NY', quality: 'MEDIUM', description: 'New York Session' };
        if (utcHour >= 0 && utcHour < 3) return { session: 'ASIAN_OPEN', quality: 'LOW', description: 'Asian Open' };
        if (utcHour >= 3 && utcHour < 7) return { session: 'ASIAN', quality: 'LOW', description: 'Asian Session' };
        return { session: 'OFF_HOURS', quality: 'VERY_LOW', description: 'Off-hours (low liquidity)' };
    }

    /**
     * Breaker Block Detection
     * A failed Order Block that gets invalidated and flips its polarity.
     * Bullish OB that gets broken becomes a bearish breaker (and vice versa).
     */
    findBreakerBlocks(candles) {
        const breakers = [];
        if (candles.length < 5) return breakers;

        // First find all OBs (including mitigated ones)
        for (let i = 1; i < candles.length - 2; i++) {
            const current = candles[i];
            const next = candles[i + 1];

            const currentBody = Math.abs(current.close - current.open);
            const nextBody = Math.abs(next.close - next.open);

            // Was a bullish OB
            if (current.close < current.open && next.close > next.open && nextBody > currentBody * 1.5) {
                // Check if it was later broken (price closed below the OB low)
                for (let k = i + 2; k < candles.length; k++) {
                    if (candles[k].close < current.low) {
                        // Bullish OB broken → becomes bearish breaker
                        breakers.push({
                            type: 'bearish_breaker',
                            high: current.high,
                            low: current.low,
                            time: current.time,
                            broken_at: candles[k].time
                        });
                        break;
                    }
                }
            }

            // Was a bearish OB
            if (current.close > current.open && next.close < next.open && nextBody > currentBody * 1.5) {
                for (let k = i + 2; k < candles.length; k++) {
                    if (candles[k].close > current.high) {
                        // Bearish OB broken → becomes bullish breaker
                        breakers.push({
                            type: 'bullish_breaker',
                            high: current.high,
                            low: current.low,
                            time: current.time,
                            broken_at: candles[k].time
                        });
                        break;
                    }
                }
            }
        }

        return breakers.slice(-3);
    }
}

module.exports = new SMCDetector();
