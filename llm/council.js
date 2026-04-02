/**
 * APEX LLM Council v3.0 — Adversarial Analysis with Multi-Provider AI
 * 
 * Enhanced with:
 * - Adversarial prompting (bull/bear case in single call)
 * - Risk score gating (blocks high-risk setups)
 * - Confidence calibration (learns from past confidence vs outcomes)
 * - Pre-filter (cheap fast model rejects obvious rejects before expensive analysis)
 * - Provider-agnostic via AI Router
 * - Lesson injection from ML loop
 */

const aiRouter = require('./aiRouter');
const mlLoop = require('../core/ml_loop');
const dashboard = require('../web/webDashboard');

class Council {
    constructor() {
        // Confidence calibration: tracks how accurate each confidence level has been
        this.confidenceHistory = {};  // { '80': { total: 10, wins: 6 }, ... }
        console.log('Council v3.0: Adversarial analysis with multi-provider AI');
    }

    /**
     * Main entry: Get a trade decision for a setup
     * Two-stage: cheap pre-filter → expensive full analysis
     */
    async getMarketDecision(analysisPacket) {
        console.log(`Council: Analyzing ${analysisPacket.symbol}...`);

        // STAGE 1: Pre-filter BYPASSED — the detector's confluence scoring (5.5+ threshold)
        // already filters aggressively. No need for a second LLM gate.
        // const shouldAnalyze = await this.preFilter(analysisPacket);

        // STAGE 2: Full adversarial analysis (best available model)
        const learnedContext = await mlLoop.getLessonsForPrompt(analysisPacket.symbol);
        const prompt = this.generateAdversarialPrompt(analysisPacket, learnedContext);
        const systemPrompt = this.getSystemPrompt();

        const result = await aiRouter.analyze(prompt, systemPrompt, { priority: 'high' });

        // Log which provider answered
        if (result._provider) {
            dashboard.logMessage(`🤖 Council: ${analysisPacket.symbol} analyzed by ${result._provider} (${result._latency}ms, ${result._dailyRemaining} calls remaining)`);
        }

        // GATE 1: Risk score check
        if (result.risk_score && result.risk_score >= 7) {
            dashboard.logMessage(`🛑 Council: ${analysisPacket.symbol} — Risk score ${result.risk_score}/10 too high. Blocking.`, 'warn');
            return { direction: 'NEUTRAL', confidence: 0, rationale: `Risk score too high: ${result.risk_score}/10. Bear case: ${result.bear_case || 'N/A'}` };
        }

        // GATE 2: Confidence calibration
        if (result.direction !== 'NEUTRAL' && result.confidence > 0) {
            const calibrated = this.calibrateConfidence(result.confidence);
            if (calibrated < result.confidence) {
                dashboard.logMessage(`📊 Confidence calibrated: ${result.confidence}% → ${calibrated}% (based on historical accuracy at this level)`);
                result.confidence = calibrated;
            }
        }

        // Log adversarial analysis
        if (result.bull_case || result.bear_case) {
            dashboard.logMessage(`📈 Bull: ${(result.bull_case || 'N/A').substring(0, 100)}`);
            dashboard.logMessage(`📉 Bear: ${(result.bear_case || 'N/A').substring(0, 100)}`);
        }

        return result;
    }

    /**
     * Pre-filter: Quick yes/no check using cheap/fast model
     * Saves ~60% of expensive analysis calls
     */
    async preFilter(packet) {
        const prompt = `Quick assessment — should this setup be analyzed further?

Symbol: ${packet.symbol} | Price: ${packet.currentPrice}
Trend: ${packet.zones?.structure?.trend || 'UNKNOWN'}
BOS: ${packet.zones?.structure?.bos ? 'YES' : 'NO'}
CHoCH: ${packet.zones?.structure?.choch ? 'YES' : 'NO'}
Order Blocks: ${packet.zones?.ob?.length || 0}
FVGs: ${packet.zones?.fvg?.length || 0}
Session: ${packet.zones?.killzone?.session || 'UNKNOWN'} (Quality: ${packet.zones?.killzone?.quality || 'UNKNOWN'})
Premium/Discount: ${packet.zones?.premium_discount?.zone || 'UNKNOWN'}
EMA20: ${packet.indicators?.ema20 || 0} EMA50: ${packet.indicators?.ema50 || 0}
RSI: ${packet.indicators?.rsi || 50}
Confluence Score: ${packet.confluenceBreakdown?.total || 0}/10

Return ONLY: {"analyze": true/false, "reason": "brief why"}`;

        const systemPrompt = 'You are a trading pre-filter. Return JSON only. Set analyze=true ONLY if the setup has clear structure (BOS or CHoCH), at least one POI (OB or FVG), and the session quality is at least MEDIUM. Otherwise analyze=false.';

        try {
            const result = await aiRouter.analyze(prompt, systemPrompt, { priority: 'prefilter', maxTokens: 100 });
            
            if (result.analyze === false || result.direction === 'NEUTRAL') {
                return false;
            }
            return true;
        } catch (e) {
            // If pre-filter fails, allow analysis (don't block on pre-filter error)
            return true;
        }
    }

    /**
     * System prompt: Elite trader with adversarial thinking
     */
    getSystemPrompt() {
        return `You are APEX Trading Council — an elite ICT/SMC institutional trader with 20 years of experience managing billions in capital.

YOUR CORE PHILOSOPHY:
- Trade like a sniper, not a machine gunner. Quality over quantity.
- ONLY trade with confirmed structure (BOS). Never counter-trend unless CHoCH is confirmed.
- Buy ONLY in DISCOUNT zones, sell ONLY in PREMIUM zones.
- You respect killzones — London and NY sessions produce the best setups.
- Liquidity sweeps CREATE the best entry opportunities.

YOUR ANALYSIS MUST FOLLOW THIS STRUCTURE:

PHASE 1 — BULL CASE:
List every reason to take this trade. What confluences support the setup? What structure confirms it? Why is this a high-probability opportunity?

PHASE 2 — BEAR CASE:
List every reason NOT to take this trade. What could go wrong? What is the market structure risk? What would invalidate this setup? Are we fighting a higher-timeframe trend? Is there news risk?

PHASE 3 — VERDICT:
Weigh both cases honestly. ONLY recommend BUY/SELL if the bull case CLEARLY outweighs the bear case AND all pre-trade checklist items pass.

PRE-TRADE CHECKLIST (ALL must pass for BUY/SELL):
□ Market structure confirms direction (BOS in favor)
□ Entry is at a valid POI (OB, FVG, breaker)
□ Price is in correct zone (discount for BUY, premium for SELL)
□ Session is active (not off-hours or very low quality)
□ No recent lesson advises against this exact setup type
□ RR is at least 1:2
□ SL is behind structural protection (swing low for BUY, swing high for SELL)
□ SL is at least 1.5x ATR from entry

RISK SCORING (1-10):
1-3: Low risk (clear trend, strong confluences, good session)
4-6: Medium risk (some confluence, some uncertainty)
7-10: High risk (fighting structure, unclear setup, bad session, recent losses)

STOP LOSS RULES:
- SL behind nearest structural level
- SL at least 1.5x ATR from entry
- For Gold: SL $5-$20 from entry
- For Forex majors: 15-50 pips
- NEVER place SL more than 2% from entry

Return ONLY valid JSON:
{
  "direction": "BUY|SELL|NEUTRAL",
  "confidence": 0-100,
  "risk_score": 1-10,
  "bull_case": "key reasons for the trade",
  "bear_case": "key reasons against the trade",
  "entry": price,
  "sl": price,
  "tp": price,
  "rationale": "final verdict summary"
}`;
    }

    /**
     * Generate adversarial analysis prompt with full market context
     */
    generateAdversarialPrompt(packet, learnedContext = '') {
        const trend = packet.indicators.ema20 > packet.indicators.ema50 ? 'BULLISH' : 'BEARISH';
        const minSL = (packet.atr * 1.5).toFixed(5);

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

=== CONFLUENCE SCORE ===
Total: ${packet.confluenceBreakdown?.total || 0}/10
Breakdown: ${JSON.stringify(packet.confluenceBreakdown?.breakdown || {})}

=== PRICE ACTION (Last ${packet.candles?.length || 0} candles, oldest → newest) ===
${packet.candles ? packet.candles.map((c, i) => `[${i + 1}] O:${c.open} H:${c.high} L:${c.low} C:${c.close}`).join('\n') : 'No candles available'}
`;

        // Inject learned context
        if (learnedContext && learnedContext.trim().length > 0) {
            prompt += `\n${learnedContext}`;
        }

        prompt += `\n=== YOUR TASK ===
Run your FULL adversarial analysis (Bull Case → Bear Case → Verdict).
If the bear case is strong, return NEUTRAL — capital preservation is priority #1.
Place SL beyond the nearest swing ${trend === 'BULLISH' ? 'low' : 'high'}, at least ${minSL} from entry.
Consider the learned lessons — do NOT repeat past mistakes.
Assign a risk_score from 1-10 (7+ = auto-reject, be honest about risk).`;

        return prompt;
    }

    /**
     * Calibrate confidence based on historical accuracy at each level
     * If the model says 80% but historically only wins 55% at that level, discount it
     */
    calibrateConfidence(rawConfidence) {
        const bucket = Math.round(rawConfidence / 10) * 10; // Group into 10s: 70, 80, 90
        const history = this.confidenceHistory[bucket];

        if (!history || history.total < 5) {
            // Not enough data, return raw
            return rawConfidence;
        }

        const actualWinRate = (history.wins / history.total) * 100;
        
        // If actual win rate is lower than claimed confidence, discount
        if (actualWinRate < bucket) {
            return Math.round(actualWinRate);
        }

        return rawConfidence;
    }

    /**
     * Record trade outcome for confidence calibration
     * Called by ml_loop when a trade closes
     */
    recordOutcome(confidence, won) {
        const bucket = Math.round(confidence / 10) * 10;
        if (!this.confidenceHistory[bucket]) {
            this.confidenceHistory[bucket] = { total: 0, wins: 0 };
        }
        this.confidenceHistory[bucket].total++;
        if (won) this.confidenceHistory[bucket].wins++;
    }
}

module.exports = new Council();
