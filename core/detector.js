const smc = require('../concepts/smc');
const council = require('../llm/council');
const orderManager = require('./orderManager');
const dashboard = require('../web/webDashboard');

class Detector {
    constructor() {
        this.lastAnalysisTime = {};
        this.analysisInterval = 60000; // 60 seconds per symbol
        this.isAnalyzing = {};
    }

    async onNewCandle(symbol, timeframe, candles) {
        try {
            // 1. Detect Zones via SMC
            const zones = smc.detectZones(candles);
            
            // 2. Calculate Technical Indicators
            const indicators = this.calculateIndicators(candles);

            // 3. Score Confluence
            const score = this.calculateConfluence(zones, indicators, candles);
            
            // Always send confluence to dashboard
            dashboard.sendConfluence(symbol, score);
            dashboard.logMessage(`${symbol}: Confluence ${score}/5 | EMA20=${indicators.ema20} RSI=${indicators.rsi}`);

            // 4. Throttle: only submit to council once per 60s per symbol, and only if score >= 4
            const now = Date.now();
            const lastTime = this.lastAnalysisTime[symbol] || 0;

            if (score >= 4 && (now - lastTime) >= this.analysisInterval && !this.isAnalyzing[symbol]) {
                this.lastAnalysisTime[symbol] = now;
                this.isAnalyzing[symbol] = true;

                dashboard.logMessage(`${symbol}: HIGH CONFLUENCE — Submitting to AI Council...`);
                
                const analysisPacket = {
                    symbol,
                    timeframe,
                    currentPrice: candles[candles.length - 1].close,
                    candles: candles.slice(-5),
                    zones,
                    indicators
                };

                setImmediate(async () => {
                    try {
                        const decision = await council.getMarketDecision(analysisPacket);
                        dashboard.logMessage(`Council: ${symbol} → ${JSON.stringify(decision)}`);

                        if (decision) {
                            dashboard.sendCouncilDecision({
                                symbol,
                                direction: decision.direction || 'NEUTRAL',
                                confidence: decision.confidence || 0,
                                rationale: decision.rationale || ''
                            });

                            if (decision.direction && decision.direction !== 'NEUTRAL' && decision.confidence >= 70) {
                                this.emitTradeSetup(symbol, decision);
                            }
                        }
                    } catch (err) {
                        dashboard.logMessage(`Council Error: ${err.message}`);
                    } finally {
                        this.isAnalyzing[symbol] = false;
                    }
                });
            }
        } catch (err) {
            console.error(`Detector Error for ${symbol}:`, err.message);
            dashboard.logMessage(`Detector Error: ${symbol} — ${err.message}`);
        }
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

    calculateConfluence(zones, indicators, candles) {
        let score = 0;
        if (zones.ob && zones.ob.length > 0) score++;
        if (zones.fvg && zones.fvg.length > 0) score++;
        if (indicators.ema20 && indicators.ema50 && indicators.ema20 !== indicators.ema50) score++;
        if (indicators.rsi > 30 && indicators.rsi < 70) score++;
        if (candles && candles.length > 0) {
            const last = candles[candles.length - 1];
            const body = Math.abs(parseFloat(last.close) - parseFloat(last.open));
            const range = parseFloat(last.high) - parseFloat(last.low);
            if (range > 0 && body / range > 0.5) score++;
        }
        return score;
    }

    async emitTradeSetup(symbol, decision) {
        dashboard.logMessage(`TRADE SIGNAL: ${decision.direction} ${symbol} @ ${decision.entry}`);
        await orderManager.executeSetup(symbol, decision);
    }
}

module.exports = new Detector();
