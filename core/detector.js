const smc = require('../concepts/smc');
const council = require('../llm/council');
const orderManager = require('./orderManager');
const dashboard = require('../web/webDashboard');

class Detector {
    constructor() {}

    async onNewCandle(symbol, timeframe, candles) {
        dashboard.logMessage(`Detector: New ${timeframe} candle for ${symbol}...`);
        
        // 1. Detect Zones via SMC
        const zones = smc.detectZones(candles);
        
        // 2. Calculate Real Technical Indicators
        const indicators = this.calculateIndicators(candles);

        // 3. Score Confluence
        const score = this.calculateConfluence(zones, indicators, candles);
        dashboard.logMessage(`Detector: Confluence Score ${score}/5 for ${symbol}`);
        dashboard.sendConfluence(score);

        if (score >= 3) {
            dashboard.logMessage(`Detector: Submitting to Council...`);
            
            const analysisPacket = {
                symbol,
                timeframe,
                currentPrice: candles[candles.length - 1].close,
                candles: candles.slice(-5),
                zones,
                indicators
            };

            const decision = await council.getMarketDecision(analysisPacket);
            dashboard.logMessage(`Detector: Council Decision for ${symbol}: ${JSON.stringify(decision)}`);

            // Push council decision to web dashboard
            if (decision) {
                dashboard.sendCouncilDecision({
                    symbol,
                    direction: decision.direction || 'NEUTRAL',
                    confidence: decision.confidence || 0,
                    rationale: decision.rationale || ''
                });
            }

            if (decision && decision.direction !== 'NEUTRAL') {
                this.emitTradeSetup(symbol, decision);
            }
        }
    }

    calculateIndicators(candles) {
        if (!candles || candles.length < 2) {
            return { ema20: 0, ema50: 0, rsi: 50 };
        }

        // Simple EMA calculations
        const closes = candles.map(c => parseFloat(c.close));
        const ema20 = this.ema(closes, Math.min(20, closes.length));
        const ema50 = this.ema(closes, Math.min(50, closes.length));
        const rsi = this.rsi(closes, 14);

        return { ema20, ema50, rsi };
    }

    ema(data, period) {
        if (data.length === 0) return 0;
        const k = 2 / (period + 1);
        let ema = data[0];
        for (let i = 1; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
        }
        return parseFloat(ema.toFixed(5));
    }

    rsi(data, period) {
        if (data.length < 2) return 50;
        let gains = 0, losses = 0;
        const len = Math.min(period, data.length - 1);
        for (let i = data.length - len; i < data.length; i++) {
            const change = data[i] - data[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        if (losses === 0) return 100;
        const rs = gains / losses;
        return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
    }

    calculateConfluence(zones, indicators, candles) {
        let score = 0;

        // 1. Order Block present
        if (zones.ob && zones.ob.length > 0) score++;

        // 2. Fair Value Gap present
        if (zones.fvg && zones.fvg.length > 0) score++;

        // 3. EMA alignment (trend confirmation)
        if (indicators.ema20 && indicators.ema50) {
            if (indicators.ema20 !== indicators.ema50) score++;
        }

        // 4. RSI not extreme (30-70 range = momentum room)
        if (indicators.rsi > 30 && indicators.rsi < 70) score++;

        // 5. Candle structure (strong body vs wick ratio)
        if (candles && candles.length > 0) {
            const last = candles[candles.length - 1];
            const body = Math.abs(last.close - last.open);
            const range = last.high - last.low;
            if (range > 0 && body / range > 0.5) score++;
        }

        return score;
    }

    async emitTradeSetup(symbol, decision) {
        dashboard.logMessage(`Detector: SENDING SETUP TO ORDER MANAGER for ${symbol}: ${decision.direction} at ${decision.entry}`);
        await orderManager.executeSetup(symbol, decision);
    }
}

module.exports = new Detector();
