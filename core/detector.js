/**
 * APEX Detector v3.0 — Enhanced Setup Detection
 * 
 * Uses full SMC engine + multi-timeframe analysis + regime detection
 * + spread filter + technical indicators + session awareness
 * to find high-probability trading setups.
 * 
 * v3.0 Enhancements:
 * - Multi-Timeframe confluence (HTF bias + MTF confirmation + LTF entry)
 * - Market regime detection (trending/ranging/volatile)
 * - Spread & microstructure filtering
 * - Advanced SMC scoring (displacement, OTE, inducement, imbalance stacking)
 * - Regime-aware minimum confluence thresholds
 */

const smc = require('../concepts/smc');
const mtf = require('../concepts/mtf');
const council = require('../llm/council');
const orderManager = require('./orderManager');
const dashboard = require('../web/webDashboard');
const tradeManager = require('./tradeManager');
const riskGuard = require('./riskGuard');
const mlLoop = require('./ml_loop');
const regimeDetector = require('./regimeDetector');
const spreadFilter = require('./spreadFilter');

class Detector {
    constructor() {
        this.lastAnalysisTime = {};
        this.analysisInterval = 60000; // 60 seconds per symbol
        this.isAnalyzing = {};
    }

    async onNewCandle(symbol, timeframe, candles, marketMeta = {}) {
        try {
            if (!candles || candles.length < 5) return;

            // 1. Update spread tracking & trade manager sync
            if (marketMeta.spread) {
                spreadFilter.updateSpread(symbol, marketMeta.spread);
            }
            tradeManager.updateCandleClose(symbol, candles[candles.length - 1]);

            // 2. Full SMC Zone Detection (v3.0 with advanced concepts)
            const zones = smc.detectZones(candles);

            // 3. Calculate Technical Indicators
            const indicators = this.calculateIndicators(candles);

            // 4. Calculate ATR for volatility awareness
            const atr = this.calculateATR(candles, 14);

            // 5. Regime Detection
            const regime = regimeDetector.detect(symbol, candles);

            // 6. Multi-Timeframe Analysis (if data available)
            let mtfResult = null;
            if (marketMeta.candles_h1 || marketMeta.candles_h4) {
                mtfResult = mtf.analyze(symbol, {
                    m15: candles,
                    h1: marketMeta.candles_h1 || null,
                    h4: marketMeta.candles_h4 || null,
                    d1: marketMeta.candles_d1 || null
                });
            }

            // 7. Enhanced Confluence Scoring (weighted by ML + structure + regime + MTF)
            const weights = mlLoop.getWeights();
            const score = this.calculateConfluence(zones, indicators, candles, weights, regime, mtfResult);

            // 8. Apply regime minimum confluence threshold
            // ⚛️ ARIA V15.3 THROUGHPUT OVERRIDE: Lowered from 6.0 to 5.5 for high-velocity demo
            const minScore = regime.adjustments?.minConfluence || 5.5;

            // 9. Send to dashboard
            dashboard.sendConfluence(symbol, score.total);
            const currentPrice = candles[candles.length - 1].close;
            
            const structureTrend = zones.structure?.trend || 'UNKNOWN';
            const pdZone = zones.premium_discount?.zone || 'UNKNOWN';
            const session = zones.killzone?.session || 'UNKNOWN';

            // ... logMessage ... (keeping it)
            dashboard.logMessage(
                `${symbol}: Score ${score.total}/${minScore} min | Price=${currentPrice} | ` +
                `Trend=${structureTrend} | Zone=${pdZone} | Session=${session} | ` +
                `Regime=${regime.regime} | ` +
                `${mtfResult ? 'MTF=' + mtfResult.htfBias + '(+' + mtfResult.mtfScore + ')' : 'MTF=N/A'}`
            );

            // 11. Submit to AI Council if high confluence
            const now = Date.now();
            const lastTime = this.lastAnalysisTime[symbol] || 0;

            // 🛡️ INSTITUTIONAL PRE-FILTER LOGIC 🛡️
            if (score.total < minScore) {
                // Only log if score is somewhat close (e.g., > 3) to prevent log spam
                if (score.total > 3.5) {
                    dashboard.logMessage(`⚠️ ${symbol}: Setup Filtered — Score ${score.total.toFixed(1)} < ${minScore.toFixed(1)} Threshold.`, 'warn');
                }
                return;
            }

            // Skip if regime says don't trade (LOW_VOLATILITY)
            if (regime.regime === 'LOW_VOLATILITY') {
                dashboard.logMessage(`⏸️ ${symbol}: HIGH CONFLUENCE (${score.total}) but LOW VOLATILITY regime. Skipping.`);
                return;
            }

            // Spread check before analysis
            if (marketMeta.spread) {
                const slDistance = atr * 1.5;
                const spreadCheck = spreadFilter.canTrade(symbol, marketMeta.spread, slDistance);
                if (!spreadCheck.allowed) {
                    dashboard.logMessage(`📊 ${symbol}: Filtered — ${spreadCheck.reason}`, 'warn');
                    return;
                }
            }

            if ((now - lastTime) >= this.analysisInterval && !this.isAnalyzing[symbol]) {
                this.lastAnalysisTime[symbol] = now;
                this.isAnalyzing[symbol] = true;

                dashboard.logMessage(`🔥 ${symbol}: HIGH CONFLUENCE (${score.total}/${minScore}) — Submitting to AI Council... [Regime: ${regime.regime}]`);

                const swings = this.findSwingPoints(candles);

                const analysisPacket = {
                    symbol,
                    timeframe,
                    currentPrice: parseFloat(currentPrice),
                    spread: marketMeta.spread || 0,
                    ask: marketMeta.ask || 0,
                    bid: marketMeta.bid || 0,
                    atr,
                    swingHigh: swings.high,
                    swingLow: swings.low,
                    candles: candles.slice(-20),
                    zones,
                    indicators,
                    confluenceBreakdown: score,
                    regime,
                    mtfAnalysis: mtfResult
                };

                setImmediate(async () => {
                    try {
                        const decision = await council.getMarketDecision(analysisPacket);
                        dashboard.logMessage(`🤖 Council: ${symbol} → ${decision.direction} (${decision.confidence}%)`);

                        if (decision) {
                            dashboard.sendCouncilDecision({
                                symbol,
                                direction: decision.direction || 'NEUTRAL',
                                confidence: decision.confidence || 0,
                                rationale: decision.rationale || ''
                            });

                            if (decision.direction && decision.direction !== 'NEUTRAL' && decision.confidence >= 70) {
                                // Attach extra context for the order manager
                                decision.indicators = indicators;
                                decision.zones = zones;
                                decision.score = score.total;
                                decision.atr = atr;
                                decision.session = zones.killzone?.session || 'unknown';
                                this.emitTradeSetup(symbol, decision);
                            }
                        }
                    } catch (err) {
                        dashboard.logMessage(`❌ Council Error: ${err.message}`);
                    } finally {
                        this.isAnalyzing[symbol] = false;
                    }
                });
            }
        } catch (err) {
            console.error(`Detector Error for ${symbol}:`, err.message);
            dashboard.logMessage(`❌ Detector Error: ${symbol} — ${err.message}`);
        }
    }

    /**
     * Enhanced Confluence Scoring System (0-10 scale)
     * 
     * Each factor is weighted based on ML learning from past trades.
     */
    calculateConfluence(zones, indicators, candles, weights = {}, regime = null, mtfResult = null) {
        let total = 0;
        const breakdown = {};

        // 1. Order Block present (0-1.5 points)
        if (zones.ob && zones.ob.length > 0) {
            const obScore = Math.min(zones.ob.length, 2) * 0.75 * (weights.obPresence || 1);
            total += obScore;
            breakdown.orderBlock = parseFloat(obScore.toFixed(2));
        }

        // 2. Fair Value Gap present (0-1 point)
        if (zones.fvg && zones.fvg.length > 0) {
            const fvgScore = 1.0 * (weights.fvgPresence || 1);
            total += fvgScore;
            breakdown.fvg = parseFloat(fvgScore.toFixed(2));
        }

        // 3. Market Structure confirmation — BOS (0-2 points) - MOST IMPORTANT
        if (zones.structure && zones.structure.bos) {
            const bosScore = 2.0 * (weights.bosConfirm || 1);
            total += bosScore;
            breakdown.bos = parseFloat(bosScore.toFixed(2));
        }

        // 4. CHoCH (reversal signal) — 1.5 points but only if against current trend
        if (zones.structure && zones.structure.choch) {
            const chochScore = 1.5;
            total += chochScore;
            breakdown.choch = parseFloat(chochScore.toFixed(2));
        }

        // 5. EMA alignment (0-1 point)
        if (indicators.ema20 && indicators.ema50 && indicators.ema20 !== indicators.ema50) {
            const emaTrend = indicators.ema20 > indicators.ema50 ? 'BULLISH' : 'BEARISH';
            const structureTrend = zones.structure?.trend || 'RANGING';
            
            if ((emaTrend === 'BULLISH' && structureTrend === 'BULLISH') || 
                (emaTrend === 'BEARISH' && structureTrend === 'BEARISH')) {
                const emaScore = 1.0 * (weights.emaDifference || 1);
                total += emaScore;
                breakdown.emaAlignment = parseFloat(emaScore.toFixed(2));
            } else {
                total += 0.5;
                breakdown.emaAlignment = 0.5;
            }
        }

        // 6. RSI in favorable zone (0-1 point)
        if (indicators.rsi > 30 && indicators.rsi < 70) {
            total += 0.5;
            breakdown.rsi = 0.5;
        }
        if ((indicators.rsi < 30 && zones.structure?.choch) || 
            (indicators.rsi > 70 && zones.structure?.choch)) {
            const rsiScore = 1.0 * (weights.rsiExtreme || 1);
            total += rsiScore;
            breakdown.rsiExtreme = parseFloat(rsiScore.toFixed(2));
        }

        // 7. Premium/Discount zone (0-1.5 points)
        if (zones.premium_discount) {
            const pd = zones.premium_discount;
            if (pd.zone === 'DISCOUNT' || pd.zone === 'PREMIUM') {
                const pdScore = 1.5 * (weights.premiumDiscount || 1);
                total += pdScore;
                breakdown.premiumDiscount = parseFloat(pdScore.toFixed(2));
            } else if (pd.zone === 'EQUILIBRIUM') {
                total += 0.5;
                breakdown.premiumDiscount = 0.5;
            }
        }

        // 8. Liquidity sweep (0-1 point)
        if (zones.liquidity && zones.liquidity.sweeps && zones.liquidity.sweeps.length > 0) {
            const liqScore = 1.0 * (weights.liquiditySweep || 1);
            total += liqScore;
            breakdown.liquiditySweep = parseFloat(liqScore.toFixed(2));
        }

        // 9. Session quality bonus (0-0.5 points)
        if (zones.killzone) {
            if (zones.killzone.quality === 'HIGHEST') {
                total += 0.5;
                breakdown.session = 0.5;
            } else if (zones.killzone.quality === 'HIGH') {
                total += 0.3;
                breakdown.session = 0.3;
            }
            if (zones.killzone.quality === 'VERY_LOW') {
                total -= 1;
                breakdown.session = -1;
            }
        }

        // 10. Candle momentum (0-0.5 points)
        if (candles && candles.length > 0) {
            const last = candles[candles.length - 1];
            const body = Math.abs(parseFloat(last.close) - parseFloat(last.open));
            const range = parseFloat(last.high) - parseFloat(last.low);
            if (range > 0 && body / range > 0.6) {
                total += 0.5;
                breakdown.candleMomentum = 0.5;
            }
        }

        // ======= v3.0 ADVANCED CONFLUENCE FACTORS =======

        // 11. Displacement detection (0-1 point) — institutional commitment
        if (zones.displacement && zones.displacement.length > 0) {
            total += 1.0;
            breakdown.displacement = 1.0;
        }

        // 12. OTE zone (0-0.75 points) — optimal fib entry
        if (zones.ote && zones.ote.inOTE) {
            total += 0.75;
            breakdown.ote = 0.75;
        }

        // 13. Inducement (0-0.5 points) — retail trap before real move
        if (zones.inducement && zones.inducement.length > 0) {
            total += 0.5;
            breakdown.inducement = 0.5;
        }

        // 14. Imbalance stacking (0-0.75 points) — strong institutional interest
        if (zones.imbalanceStack && zones.imbalanceStack.stacked) {
            total += 0.75;
            breakdown.imbalanceStack = 0.75;
        }

        // 15. Wick rejections at POI (0-0.5 points)
        if (zones.wickRejections && zones.wickRejections.length > 0) {
            total += 0.5;
            breakdown.wickRejection = 0.5;
        }

        // 16. Multi-Timeframe bonus (0-3 points)
        if (mtfResult) {
            total += mtfResult.mtfScore;
            breakdown.mtfAlignment = mtfResult.mtfScore;

            // If HTF conflicts with trade direction, cap score
            if (mtfResult.conflict) {
                total = Math.min(total, 5);
                breakdown.mtfConflict = 'CAPPED at 5';
            }
        }

        // 17. Regime adjustment
        if (regime && regime.adjustments) {
            // In trending regime, boost BOS weight
            if (regime.regime === 'TRENDING' && breakdown.bos) {
                total += 0.5;
                breakdown.regimeBonus = 0.5;
            }
            // In ranging regime, boost OB/FVG weight  
            if (regime.regime === 'RANGING' && (breakdown.orderBlock || breakdown.fvg)) {
                total += 0.5;
                breakdown.regimeBonus = 0.5;
            }
        }

        // Apply base confidence multiplier
        total *= (weights.baseConfidence || 1);

        // Cap at 10
        total = Math.min(10, Math.max(0, total));

        return {
            total: parseFloat(total.toFixed(1)),
            breakdown
        };
    }

    calculateATR(candles, period) {
        if (!candles || candles.length < 2) return 0;

        const len = Math.min(period, candles.length - 1);
        let sumTR = 0;

        for (let i = candles.length - len; i < candles.length; i++) {
            const high = parseFloat(candles[i].high);
            const low = parseFloat(candles[i].low);
            const prevClose = parseFloat(candles[i - 1].close);

            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            sumTR += tr;
        }

        return parseFloat((sumTR / len).toFixed(5));
    }

    findSwingPoints(candles, lookback = 20) {
        if (!candles || candles.length < 3) return { high: 0, low: 0 };

        const recent = candles.slice(-lookback);
        let swingHigh = -Infinity;
        let swingLow = Infinity;

        for (const c of recent) {
            const h = parseFloat(c.high);
            const l = parseFloat(c.low);
            if (h > swingHigh) swingHigh = h;
            if (l < swingLow) swingLow = l;
        }

        return { high: swingHigh, low: swingLow };
    }

    calculateIndicators(candles) {
        if (!candles || candles.length < 2) return { ema20: 0, ema50: 0, rsi: 50 };

        const closes = candles.map(c => {
            const v = parseFloat(c.close);
            return isNaN(v) ? 0 : v;
        });

        return {
            ema20: this.ema(closes, Math.min(20, closes.length)),
            ema50: this.ema(closes, Math.min(50, closes.length)),
            rsi: this.rsi(closes, Math.min(14, closes.length - 1))
        };
    }

    ema(data, period) {
        if (!data || data.length === 0) return 0;
        const k = 2 / (period + 1);
        let ema = data[0];
        for (let i = 1; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
        }
        return parseFloat(ema.toFixed(5));
    }

    rsi(data, period) {
        if (!data || data.length < 2 || period < 1) return 50;
        let gains = 0, losses = 0;
        const len = Math.min(period, data.length - 1);
        for (let i = data.length - len; i < data.length; i++) {
            const change = data[i] - data[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        if (losses === 0) return 100;
        return parseFloat((100 - 100 / (1 + gains / losses)).toFixed(2));
    }

    async emitTradeSetup(symbol, decision) {
        dashboard.logMessage(`🚀 TRADE SIGNAL: ${decision.direction} ${symbol} @ ${decision.entry} SL=${decision.sl} TP=${decision.tp}`);
        await orderManager.executeSetup(symbol, decision);
    }
}

module.exports = new Detector();
