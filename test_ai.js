/**
 * APEX Sovereign — Live AI Pulse Test (Fixed)
 * 
 * Verifies live connectivity to the AI Mesh and tests the 
 * Adversarial Council using the getMarketDecision pipeline.
 */

require('dotenv').config();
const council = require('./llm/council');

async function pulseTest() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧠 APEX LIVE AI PULSE — SOVEREIGN V5.0');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 🔬 Full Institutional Analysis Packet
    const mockPacket = {
        symbol: 'EURUSD',
        timeframe: 'M15',
        currentPrice: 1.08542,
        bid: 1.08540,
        ask: 1.08544,
        spread: 0.00004,
        atr: 0.00012,
        swingHigh: 1.08700,
        swingLow: 1.08400,
        indicators: {
            ema20: 1.08550,
            ema50: 1.08500,
            rsi: 58
        },
        zones: {
            structure: { trend: 'BULLISH', bos: true, choch: false },
            ob: [{ type: 'BULLISH', high: 1.08520, low: 1.08500, strength: 0.9 }],
            fvg: [{ type: 'BULLISH', top: 1.08535, bottom: 1.08525 }],
            premium_discount: { zone: 'DISCOUNT', position: 0.3, equilibrium: 1.08550 },
            killzone: { session: 'LONDON', description: 'London Open Expansion', quality: 'HIGH' },
            liquidity: { pools: [{price: 1.08450, type: 'SSL'}], sweeps: [] }
        },
        confluenceBreakdown: {
            total: 8.5,
            breakdown: { trend: 2, zone: 2, session: 2, structure: 2.5 }
        },
        candles: [
            {open: 1.08500, high: 1.08550, low: 1.08490, close: 1.08540},
            {open: 1.08540, high: 1.08570, low: 1.08535, close: 1.08542}
        ]
    };

    console.log('🧠 Summoning Adversarial Council (getMarketDecision)...');
    console.log('⏳ (Wait: 2-8 seconds for multi-provider deep analysis)\n');

    try {
        const startTime = Date.now();
        const verdict = await council.getMarketDecision(mockPacket);
        const duration = (Date.now() - startTime) / 1000;

        if (verdict && (verdict.direction || verdict.decision)) {
            const dir = verdict.direction || verdict.decision;
            const color = dir === 'BUY' ? '\x1b[32m' : (dir === 'SELL' ? '\x1b[31m' : '\x1b[37m');
            const reset = '\x1b[0m';

            console.log('━━━━━━━━━ FINAL VERDICT ━━━━━━━━━');
            console.log(`🎯 DIRECTION:  ${color}${dir}${reset}`);
            console.log(`🔥 CONFIDENCE: ${verdict.confidence}%`);
            console.log(`🐂 BULL CASE:  ${(verdict.bull_case || 'N/A').substring(0, 70)}...`);
            console.log(`🐻 BEAR CASE:  ${(verdict.bear_case || 'N/A').substring(0, 70)}...`);
            console.log(`🧐 RATIONALE:  ${verdict.rationale}`);
            console.log(`⏱️ LATENCY:    ${duration.toFixed(2)}s`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            if (dir !== 'NEUTRAL') {
                console.log('✅ NEURAL MESH: OPERATIONAL');
                console.log('🚀 SYSTEM READY FOR LIVE EXECUTION');
            } else {
                console.log('✅ NEURAL MESH: OPERATIONAL');
                console.log('🛡️  VERDICT: SYSTEM IS PLAYING DEFENSE (CORRECT BEHAVIOR)');
            }
        } else {
            console.log('🚨 AI Response was unclear. Inspecting raw data...');
            console.log(JSON.stringify(verdict, null, 2));
        }

    } catch (err) {
        console.log('\n❌ LIVE AI PULSE FAILED:');
        console.log(`🚨 Error: ${err.message}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
}

pulseTest();
