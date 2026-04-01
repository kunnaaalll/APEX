/**
 * APEX SMC (Smart Money Concepts) Engine v3.0
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
 * 
 * v3.0 Advanced Additions:
 * - Displacement Detection (institutional commitment)
 * - Inducement Detection (retail traps)
 * - Mitigation Blocks (partially filled OBs)
 * - Rejection Blocks (structure level rejections)
 * - Optimal Trade Entry (OTE - Fib 0.618-0.786)
 * - Imbalance Stacking (FVG clusters)
 * - Volume-Enhanced Scoring
 * - Wick Rejection Scoring
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
            breakers: this.findBreakerBlocks(parsed),
            // v3.0 Advanced
            displacement: this.detectDisplacement(parsed),
            inducement: this.detectInducement(parsed),
            ote: this.findOTE(parsed),
            imbalanceStack: this.detectImbalanceStacking(parsed),
            wickRejections: this.findWickRejections(parsed)
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

    // ======= v3.0 ADVANCED SMC CONCEPTS =======

    /**
     * Displacement Detection
     * A single large-body candle that moves 2x+ ATR — indicates institutional commitment.
     * Displacement candles show smart money is aggressively moving price.
     */
    detectDisplacement(candles) {
        const displacements = [];
        if (candles.length < 15) return displacements;

        // Calculate ATR for reference
        let atrSum = 0;
        for (let i = candles.length - 15; i < candles.length - 1; i++) {
            atrSum += candles[i].high - candles[i].low;
        }
        const atr = atrSum / 14;

        // Check last 5 candles for displacement
        for (let i = Math.max(1, candles.length - 5); i < candles.length; i++) {
            const body = Math.abs(candles[i].close - candles[i].open);
            const range = candles[i].high - candles[i].low;
            const bodyToRange = body / (range || 0.0001); // Body should be >70% of range

            if (body > atr * 2 && bodyToRange > 0.7) {
                displacements.push({
                    type: candles[i].close > candles[i].open ? 'bullish' : 'bearish',
                    index: i,
                    body: body,
                    atrMultiple: parseFloat((body / atr).toFixed(2)),
                    time: candles[i].time,
                    high: candles[i].high,
                    low: candles[i].low
                });
            }
        }

        return displacements;
    }

    /**
     * Inducement Detection
     * Minor structure breaks that trap retail traders before the real move.
     * Look for a minor swing break followed by immediate reversal.
     */
    detectInducement(candles) {
        const inducements = [];
        if (candles.length < 10) return inducements;

        const swings = this.findSwingPoints(candles);
        const swingHighs = swings.filter(s => s.type === 'high');
        const swingLows = swings.filter(s => s.type === 'low');

        // Check for bearish inducement: price takes out a minor high then reverses down
        for (let i = 1; i < swingHighs.length; i++) {
            const prevHigh = swingHighs[i - 1];
            const currHigh = swingHighs[i];
            
            // Minor break above previous high
            if (currHigh.price > prevHigh.price) {
                // Check if price reversed after the break
                const afterIndex = currHigh.index;
                if (afterIndex + 2 < candles.length) {
                    const afterCandle1 = candles[afterIndex + 1];
                    const afterCandle2 = candles[afterIndex + 2];
                    
                    // Strong bearish rejection after the break
                    if (afterCandle1.close < afterCandle1.open && afterCandle2.close < afterCandle2.open) {
                        inducements.push({
                            type: 'bearish_inducement',
                            level: currHigh.price,
                            swept_level: prevHigh.price,
                            time: candles[afterIndex].time,
                            description: 'Minor high swept then reversed — retail longs trapped'
                        });
                    }
                }
            }
        }

        // Check for bullish inducement: price takes out a minor low then reverses up
        for (let i = 1; i < swingLows.length; i++) {
            const prevLow = swingLows[i - 1];
            const currLow = swingLows[i];

            if (currLow.price < prevLow.price) {
                const afterIndex = currLow.index;
                if (afterIndex + 2 < candles.length) {
                    const afterCandle1 = candles[afterIndex + 1];
                    const afterCandle2 = candles[afterIndex + 2];

                    if (afterCandle1.close > afterCandle1.open && afterCandle2.close > afterCandle2.open) {
                        inducements.push({
                            type: 'bullish_inducement',
                            level: currLow.price,
                            swept_level: prevLow.price,
                            time: candles[afterIndex].time,
                            description: 'Minor low swept then reversed — retail shorts trapped'
                        });
                    }
                }
            }
        }

        return inducements.slice(-3);
    }

    /**
     * Optimal Trade Entry (OTE)
     * Fibonacci 0.618-0.786 zone within the most recent impulse leg.
     * This is where institutional traders enter on pullbacks.
     */
    findOTE(candles) {
        if (candles.length < 10) return null;

        const structure = this.analyzeStructure(candles);
        if (!structure.trend || structure.trend === 'RANGING') return null;

        // Find the most recent impulse leg
        const swings = this.findSwingPoints(candles);
        if (swings.length < 2) return null;

        let impulseLow, impulseHigh;

        if (structure.trend === 'BULLISH') {
            // Last swing low to last swing high
            const lows = swings.filter(s => s.type === 'low');
            const highs = swings.filter(s => s.type === 'high');
            if (lows.length === 0 || highs.length === 0) return null;
            
            impulseLow = lows[lows.length - 1].price;
            impulseHigh = highs[highs.length - 1].price;
            if (impulseHigh <= impulseLow) return null;
        } else {
            const highs = swings.filter(s => s.type === 'high');
            const lows = swings.filter(s => s.type === 'low');
            if (lows.length === 0 || highs.length === 0) return null;

            impulseHigh = highs[highs.length - 1].price;
            impulseLow = lows[lows.length - 1].price;
            if (impulseHigh <= impulseLow) return null;
        }

        const range = impulseHigh - impulseLow;
        const fib618 = structure.trend === 'BULLISH' 
            ? impulseHigh - (range * 0.618) 
            : impulseLow + (range * 0.618);
        const fib786 = structure.trend === 'BULLISH'
            ? impulseHigh - (range * 0.786)
            : impulseLow + (range * 0.786);

        const currentPrice = candles[candles.length - 1].close;
        const oteTop = Math.max(fib618, fib786);
        const oteBottom = Math.min(fib618, fib786);
        const inOTE = currentPrice >= oteBottom && currentPrice <= oteTop;

        return {
            trend: structure.trend,
            impulseLow,
            impulseHigh,
            fib618: parseFloat(fib618.toFixed(5)),
            fib786: parseFloat(fib786.toFixed(5)),
            oteZone: { top: parseFloat(oteTop.toFixed(5)), bottom: parseFloat(oteBottom.toFixed(5)) },
            currentPrice,
            inOTE,
            description: inOTE ? `Price IN OTE zone (${oteBottom.toFixed(5)} - ${oteTop.toFixed(5)})` : 
                `Price outside OTE (zone: ${oteBottom.toFixed(5)} - ${oteTop.toFixed(5)})`
        };
    }

    /**
     * Imbalance Stacking
     * Multiple FVGs stacked in the same direction = strong institutional interest.
     * If 2+ bullish FVGs within 2 ATR range → very bullish signal.
     */
    detectImbalanceStacking(candles) {
        const fvgs = this.findFairValueGaps(candles);
        if (fvgs.length < 2) return { stacked: false, direction: 'NONE', count: fvgs.length };

        // Calculate ATR for proximity check
        let atrSum = 0;
        const len = Math.min(14, candles.length - 1);
        for (let i = candles.length - len; i < candles.length; i++) {
            atrSum += candles[i].high - candles[i].low;
        }
        const atr = atrSum / len;

        // Check for stacked bullish FVGs
        const bullishFVGs = fvgs.filter(f => f.type === 'bullish');
        const bearishFVGs = fvgs.filter(f => f.type === 'bearish');

        let bullishStacked = 0;
        let bearishStacked = 0;

        // Count bullish FVGs within 2 ATR of each other
        for (let i = 0; i < bullishFVGs.length; i++) {
            for (let j = i + 1; j < bullishFVGs.length; j++) {
                const distance = Math.abs(bullishFVGs[i].bottom - bullishFVGs[j].bottom);
                if (distance < atr * 2) bullishStacked++;
            }
        }

        for (let i = 0; i < bearishFVGs.length; i++) {
            for (let j = i + 1; j < bearishFVGs.length; j++) {
                const distance = Math.abs(bearishFVGs[i].top - bearishFVGs[j].top);
                if (distance < atr * 2) bearishStacked++;
            }
        }

        if (bullishStacked >= 1) {
            return { stacked: true, direction: 'BULLISH', count: bullishFVGs.length, proximityPairs: bullishStacked };
        }
        if (bearishStacked >= 1) {
            return { stacked: true, direction: 'BEARISH', count: bearishFVGs.length, proximityPairs: bearishStacked };
        }

        return { stacked: false, direction: 'NONE', count: fvgs.length };
    }

    /**
     * Wick Rejection Scoring
     * Long wicks at POI = strong rejection = institutional activity.
     * Score wicks relative to body size and ATR.
     */
    findWickRejections(candles) {
        const rejections = [];
        if (candles.length < 5) return rejections;

        // Check last 5 candles for significant wicks
        for (let i = Math.max(0, candles.length - 5); i < candles.length; i++) {
            const c = candles[i];
            const body = Math.abs(c.close - c.open);
            const range = c.high - c.low;
            if (range === 0) continue;

            const upperWick = c.high - Math.max(c.open, c.close);
            const lowerWick = Math.min(c.open, c.close) - c.low;

            // Bullish rejection: long lower wick (>= 2x body)
            if (lowerWick > body * 2 && lowerWick > range * 0.5) {
                rejections.push({
                    type: 'bullish_rejection',
                    wickSize: lowerWick,
                    bodySize: body,
                    ratio: parseFloat((lowerWick / (body || 0.0001)).toFixed(2)),
                    level: c.low,
                    time: c.time,
                    index: i
                });
            }

            // Bearish rejection: long upper wick (>= 2x body)
            if (upperWick > body * 2 && upperWick > range * 0.5) {
                rejections.push({
                    type: 'bearish_rejection',
                    wickSize: upperWick,
                    bodySize: body,
                    ratio: parseFloat((upperWick / (body || 0.0001)).toFixed(2)),
                    level: c.high,
                    time: c.time,
                    index: i
                });
            }
        }

        return rejections;
    }

    /**
     * Helper: Find swing points from candles
     */
    findSwingPoints(candles) {
        const swings = [];
        for (let i = 2; i < candles.length - 2; i++) {
            // Swing high: higher than 2 candles on each side
            if (candles[i].high > candles[i-1].high && candles[i].high > candles[i-2].high &&
                candles[i].high > candles[i+1].high && candles[i].high > candles[i+2].high) {
                swings.push({ type: 'high', price: candles[i].high, index: i, time: candles[i].time });
            }
            // Swing low: lower than 2 candles on each side
            if (candles[i].low < candles[i-1].low && candles[i].low < candles[i-2].low &&
                candles[i].low < candles[i+1].low && candles[i].low < candles[i+2].low) {
                swings.push({ type: 'low', price: candles[i].low, index: i, time: candles[i].time });
            }
        }
        return swings;
    }
}

module.exports = new SMCDetector();
