/**
 * APEX Detector v2.0 — Enhanced Setup Detection
 * 
 * Uses the full SMC engine + technical indicators + session awareness
 * to find high-probability trading setups.
 * 
 * Enhanced with:
 * - Structure-aware confluence scoring (BOS/CHoCH weighting)
 * - Premium/Discount zone validation
 * - Session quality weighting
 * - ML weight integration
 * - Trade manager structure-break monitoring
 */

const smc = require('../concepts/smc');
const council = require('../llm/council');
const orderManager = require('./orderManager');
const dashboard = require('../web/webDashboard');
const tradeManager = require('./tradeManager');
const riskGuard = require('./riskGuard');
const mlLoop = require('./ml_loop');

class Detector {
    constructor() {
        this.lastAnalysisTime = {};
        this.analysisInterval = 60000; // 60 seconds per symbol
        this.isAnalyzing = {};
    }

    async onNewCandle(symbol, timeframe, candles, marketMeta = {}) {
        try {
            if (!candles || candles.length < 5) return;

            // 1. Full SMC Zone Detection (enhanced)
            const zones = smc.detectZones(candles);

            // 2. Calculate Technical Indicators
            const indicators = this.calculateIndicators(candles);

            // 3. Calculate ATR for volatility awareness
            const atr = this.calculateATR(candles, 14);

            // 4. Enhanced Confluence Scoring (weighted by ML + structure)
            const weights = mlLoop.getWeights();
            const score = this.calculateConfluence(zones, indicators, candles, weights);

            // 5. Send to dashboard
            dashboard.sendConfluence(symbol, score.total);
            const currentPrice = candles[candles.length - 1].close;
            
            const structureTrend = zones.structure?.trend || 'UNKNOWN';
            const pdZone = zones.premium_discount?.zone || 'UNKNOWN';
            const session = zones.killzone?.session || 'UNKNOWN';

            dashboard.logMessage(
                `${symbol}: Score ${score.total}/10 | Price=${currentPrice} | ` +
                `Trend=${structureTrend} | Zone=${pdZone} | Session=${session} | ` +
                `EMA20=${indicators.ema20} RSI=${indicators.rsi} ATR=${atr}`
            );

            // 6. Check for structure breaks against managed trades
            if (zones.structure) {
                tradeManager.checkStructureBreaks(symbol, zones.structure);
            }

            // 7. Submit to AI Council if high confluence
            const now = Date.now();
            const lastTime = this.lastAnalysisTime[symbol] || 0;
            const minScore = 6; // Higher threshold with enhanced scoring (out of 10)

            if (score.total >= minScore && (now - lastTime) >= this.analysisInterval && !this.isAnalyzing[symbol]) {
                this.lastAnalysisTime[symbol] = now;
                this.isAnalyzing[symbol] = true;

                dashboard.logMessage(`🔥 ${symbol}: HIGH CONFLUENCE (${score.total}/10) — Submitting to AI Council...`);

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
                    confluenceBreakdown: score
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
    calculateConfluence(zones, indicators, candles, weights = {}) {
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
            
            // Extra point if EMA and structure agree
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
            // RSI not extreme = good for trend continuation
            total += 0.5;
            breakdown.rsi = 0.5;
        }
        // RSI extreme with structure = even better (reversal opportunity)
        if ((indicators.rsi < 30 && zones.structure?.choch) || 
            (indicators.rsi > 70 && zones.structure?.choch)) {
            const rsiScore = 1.0 * (weights.rsiExtreme || 1);
            total += rsiScore;
            breakdown.rsiExtreme = parseFloat(rsiScore.toFixed(2));
        }

        // 7. Premium/Discount zone (0-1.5 points)
        if (zones.premium_discount) {
            const pd = zones.premium_discount;
            // Most valuable: BUY in discount or SELL in premium
            if (pd.zone === 'DISCOUNT' || pd.zone === 'PREMIUM') {
                const pdScore = 1.5 * (weights.premiumDiscount || 1);
                total += pdScore;
                breakdown.premiumDiscount = parseFloat(pdScore.toFixed(2));
            } else if (pd.zone === 'EQUILIBRIUM') {
                total += 0.5;
                breakdown.premiumDiscount = 0.5;
            }
        }

        // 8. Liquidity sweep (0-1 point) — powerful confirmation
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
            // Penalize low-quality sessions
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
