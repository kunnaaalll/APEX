/**
 * APEX LLM Council v2.0 — Enhanced with Memory and Self-Learning
 * 
 * The brain of the system. Uses OpenRouter as the AI engine,
 * enhanced with:
 * - Lesson injection from past trades
 * - Performance-aware prompting
 * - Confidence calibration
 * - Pre-trade checklist
 * - Session-aware analysis
 */

const openrouter = require('./openrouter');
const mlLoop = require('../core/ml_loop');
const smc = require('../concepts/smc');

class Council {
    constructor() {
        console.log(`Council: Using OpenRouter (${process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'}) as AI engine`);
    }

    async getMarketDecision(analysisPacket) {
        console.log(`Council: Analyzing ${analysisPacket.symbol}...`);

        // Get learned context from past trades
        const learnedContext = await mlLoop.getLessonsForPrompt(analysisPacket.symbol);

        const prompt = this.generatePrompt(analysisPacket, learnedContext);
        const systemPrompt = this.getSystemPrompt();

        return await openrouter.analyze(prompt, systemPrompt);
    }

    getSystemPrompt() {
        return `You are APEX Trading Council — an elite ICT/SMC institutional trader with 20 years of experience managing billions in capital.

YOUR TRADING PHILOSOPHY:
- You trade like a sniper, not a machine gunner. Fewer, higher-quality trades.
- You ONLY trade with the trend confirmed by market structure (BOS). Never counter-trend unless CHoCH is confirmed.
- You buy in DISCOUNT zones only, sell in PREMIUM zones only.
- You respect killzones — London and NY sessions are where the best setups form.
- You understand that liquidity sweeps CREATE the best entry opportunities.

ANALYSIS FRAMEWORK:
1. Market Structure First: Is the trend bullish (higher highs/higher lows) or bearish? Don't fight the structure.
2. Point of Interest: Is price at or near a valid OB, FVG, or breaker block?
3. Entry Confirmation: Has there been a liquidity sweep + displacement + confirmation candle?
4. Premium/Discount: Are you buying in discount (below 0.5 Fib of range) or selling in premium?
5. Session Context: Is this a high-probability session (London/NY)?

DECISION RULES:
- Only BUY/SELL if confidence >= 70%. Otherwise NEUTRAL.
- NEVER enter without structure confirmation (BOS or CHoCH).
- Min 1:2 Risk-Reward ratio.
- Entry must be the CURRENT price provided.

STOP LOSS PLACEMENT (CRITICAL):
- SL behind the nearest structural level (swing low for BUY, swing high for SELL).
- SL must be at least 1.5x ATR from entry — anything tighter gets stopped by noise.
- Add spread to SL distance.
- For Gold (XAU): SL $5-$20 from entry using ATR.
- For Forex majors: 15-50 pips from entry.
- For Forex crosses: 20-60 pips.
- For JPY pairs: 20-60 pips.

TAKE PROFIT:
- TP at the next liquidity pool, opposite order block, or key structure.
- Minimum 2x SL distance (1:2 RR minimum).

CRITICAL CONSTRAINTS:
- Never place SL more than 2% from entry.
- Never place SL tighter than 1.5x ATR.
- Use swing high/low reference for SL placement.
- If market structure is unclear or ranging, return NEUTRAL.
- If you're in a losing streak, be MORE selective, not less.
- If recent lessons indicate a pattern isn't working, AVOID that setup.

PRE-TRADE CHECKLIST (verify ALL before recommending BUY/SELL):
□ Market structure confirms direction (BOS in favor)
□ Entry is at a valid POI (OB, FVG, breaker)
□ Price is in correct zone (discount for BUY, premium for SELL)
□ Session is active (London or NY, not Asian dead hours)
□ No recent lesson advises against this exact setup type
□ RR is at least 1:2
□ SL is behind structural protection

Return ONLY valid JSON: {"direction":"BUY|SELL|NEUTRAL","confidence":0-100,"entry":price,"sl":price,"tp":price,"rationale":"why"}`;
    }

    generatePrompt(packet, learnedContext = '') {
        const trend = packet.indicators.ema20 > packet.indicators.ema50 ? 'BULLISH' : 'BEARISH';
        const minSL = (packet.atr * 1.5).toFixed(5);
        
        // Get structure info
        const structure = packet.zones.structure || {};
        const premiumDiscount = packet.zones.premium_discount || {};
        const killzone = packet.zones.killzone || {};
        const liquidity = packet.zones.liquidity || {};

        let prompt = `=== MARKET ANALYSIS REQUEST ===
Symbol: ${packet.symbol} | Timeframe: ${packet.timeframe}
Current Price: ${packet.currentPrice}
Spread: ${packet.spread || 'unknown'} | Bid: ${packet.bid || 'N/A'} | Ask: ${packet.ask || 'N/A'}

=== TECHNICAL INDICATORS ===
ATR(14): ${packet.atr} | Minimum SL: ${minSL} (1.5x ATR)
EMA20: ${packet.indicators.ema20} | EMA50: ${packet.indicators.ema50} | EMA Trend: ${trend}
RSI(14): ${packet.indicators.rsi}
Swing High: ${packet.swingHigh} | Swing Low: ${packet.swingLow}

=== MARKET STRUCTURE (SMC) ===
Trend: ${structure.trend || 'UNKNOWN'}
BOS: ${structure.bos ? `YES — ${structure.lastBOS ? structure.lastBOS.type + ' at ' + structure.lastBOS.level : 'detected'}` : 'NO'}
CHoCH: ${structure.choch ? `YES — ${structure.lastCHoCH ? structure.lastCHoCH.type + ' at ' + structure.lastCHoCH.level : 'detected'}` : 'NO'}
Swing Highs: ${structure.swingHighs ? structure.swingHighs.map(s => s.price.toFixed(5)).join(', ') : 'N/A'}
Swing Lows: ${structure.swingLows ? structure.swingLows.map(s => s.price.toFixed(5)).join(', ') : 'N/A'}

=== ZONES ===
Order Blocks: ${JSON.stringify(packet.zones.ob?.map(ob => ({ type: ob.type, high: ob.high, low: ob.low, strength: ob.strength })) || 'none')}
Fair Value Gaps: ${JSON.stringify(packet.zones.fvg?.map(f => ({ type: f.type, top: f.top, bottom: f.bottom })) || 'none')}
Breaker Blocks: ${JSON.stringify(packet.zones.breakers || 'none')}

=== PREMIUM/DISCOUNT ===
Zone: ${premiumDiscount.zone || 'UNKNOWN'} (Position: ${premiumDiscount.position || 'N/A'})
Equilibrium: ${premiumDiscount.equilibrium || 'N/A'}
Discount Level: ${premiumDiscount.discount || 'N/A'}
Premium Level: ${premiumDiscount.premium || 'N/A'}

=== LIQUIDITY ===
Pools: ${JSON.stringify(liquidity.pools?.slice(-3) || 'none')}
Recent Sweeps: ${JSON.stringify(liquidity.sweeps || 'none')}

=== SESSION ===
Session: ${killzone.session || 'UNKNOWN'} (${killzone.description || ''})
Quality: ${killzone.quality || 'UNKNOWN'}

=== PRICE ACTION (Last ${packet.candles?.length || 0} candles, oldest → newest) ===
${packet.candles ? packet.candles.map((c, i) => `[${i+1}] O:${c.open} H:${c.high} L:${c.low} C:${c.close}`).join('\n') : 'No candles available'}
`;

        // Inject learned context (THE KEY TO LEARNING)
        if (learnedContext && learnedContext.trim().length > 0) {
            prompt += `\n${learnedContext}`;
        }

        prompt += `\n=== YOUR TASK ===
Analyze this setup using your pre-trade checklist. 
If ANY checklist item fails, return NEUTRAL.
Place SL beyond the nearest swing ${trend === 'BULLISH' ? 'low' : 'high'}, at least ${minSL} from entry.
Consider the learned lessons above — do NOT repeat past mistakes.`;

        return prompt;
    }
}

module.exports = new Council();
