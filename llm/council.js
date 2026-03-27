const openrouter = require('./openrouter');

class Council {
    constructor() {
        console.log(`Council: Using OpenRouter (${process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'}) as AI engine`);
    }

    async getMarketDecision(analysisPacket) {
        console.log(`Council: Analyzing ${analysisPacket.symbol}...`);
        
        const prompt = this.generatePrompt(analysisPacket);
        const systemPrompt = this.getSystemPrompt();

        return await openrouter.analyze(prompt, systemPrompt);
    }

    getSystemPrompt() {
        return `You are APEX Trading Council. Analyze market data using ICT/SMC (Order Blocks, FVG, Liquidity, BOS/CHoCH), Wyckoff, Elliott Wave, Supply/Demand, and Fibonacci.

RULES:
- Only BUY/SELL if confidence >= 70%
- Otherwise return NEUTRAL
- SL beyond structure, TP at next liquidity
- Min 1:2 Risk-Reward

Return ONLY valid JSON: {"direction":"BUY|SELL|NEUTRAL","confidence":0-100,"entry":price,"sl":price,"tp":price,"rationale":"why"}`;
    }

    generatePrompt(packet) {
        const trend = packet.indicators.ema20 > packet.indicators.ema50 ? 'BULLISH' : 'BEARISH';
        return `${packet.symbol} ${packet.timeframe} | Price: ${packet.currentPrice} | Trend: ${trend}
EMA20=${packet.indicators.ema20} EMA50=${packet.indicators.ema50} RSI=${packet.indicators.rsi}
OB=${JSON.stringify(packet.zones.ob)} FVG=${JSON.stringify(packet.zones.fvg)}
Candles: ${packet.candles.map(c => `O:${c.open} H:${c.high} L:${c.low} C:${c.close}`).join(' | ')}`;
    }
}

module.exports = new Council();
