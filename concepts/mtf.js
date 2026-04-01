/**
 * APEX Multi-Timeframe (MTF) Analysis Engine
 * 
 * The #1 edge of experienced traders: reading multiple timeframes.
 * 
 * Framework:
 * - HTF (H4/D1): Directional bias — ONLY trade in this direction
 * - MTF (H1): Structure confirmation — Must have BOS/CHoCH alignment
 * - LTF (M5/M15): Precision entry — Where to actually enter
 * 
 * Confluence Bonus: 0-3 points added when timeframes align
 */

const smc = require('./smc');
const dashboard = require('../web/webDashboard');

class MTFAnalysis {
    constructor() {
        // Cache HTF analysis to avoid redundant computation
        this.htfCache = {};      // symbol -> { bias, structure, timestamp }
        this.mtfCache = {};      // symbol -> { structure, timestamp }
        this.cacheMaxAge = 300000; // 5 minutes for HTF, refreshed on new data
    }

    /**
     * Run full multi-timeframe analysis
     * 
     * @param {string} symbol - Trading pair
     * @param {object} candleData - { m15: [], h1: [], h4: [], d1: [] }
     * @returns {object} MTF analysis result
     */
    analyze(symbol, candleData) {
        const result = {
            htfBias: 'NEUTRAL',
            mtfConfirmation: false,
            ltfReady: false,
            mtfScore: 0,       // 0-3 bonus points
            aligned: false,
            conflict: false,
            details: {}
        };

        // === HTF ANALYSIS (H4 / D1) — Directional Bias ===
        const htf = this.analyzeHTF(symbol, candleData.h4, candleData.d1);
        result.htfBias = htf.bias;
        result.details.htf = htf;

        // === MTF ANALYSIS (H1) — Structure Confirmation ===
        const mtf = this.analyzeMTF(symbol, candleData.h1, htf.bias);
        result.mtfConfirmation = mtf.confirmed;
        result.details.mtf = mtf;

        // === LTF ANALYSIS (M15) — Entry Readiness ===
        const ltf = this.analyzeLTF(symbol, candleData.m15, htf.bias);
        result.ltfReady = ltf.ready;
        result.details.ltf = ltf;

        // === ALIGNMENT CHECK ===
        if (htf.bias !== 'NEUTRAL' && mtf.confirmed && ltf.ready) {
            result.aligned = true;
            result.mtfScore = 3; // Full alignment = max bonus
        } else if (htf.bias !== 'NEUTRAL' && mtf.confirmed) {
            result.mtfScore = 2; // HTF + MTF aligned but LTF not ready
        } else if (htf.bias !== 'NEUTRAL') {
            result.mtfScore = 1; // Only HTF bias clear
        }

        // === CONFLICT DETECTION ===
        if (htf.bias === 'BULLISH' && mtf.structure?.choch && 
            mtf.structure?.lastCHoCH?.type === 'bearish_reversal') {
            result.conflict = true;
            result.mtfScore = 0;
        }
        if (htf.bias === 'BEARISH' && mtf.structure?.choch && 
            mtf.structure?.lastCHoCH?.type === 'bullish_reversal') {
            result.conflict = true;
            result.mtfScore = 0;
        }

        return result;
    }

    /**
     * HTF Analysis — Determine directional bias from H4/D1
     */
    analyzeHTF(symbol, h4Candles, d1Candles) {
        const result = { bias: 'NEUTRAL', h4Trend: 'RANGING', d1Trend: 'RANGING', strength: 0 };

        // D1 structure
        if (d1Candles && d1Candles.length >= 5) {
            const d1Zones = smc.detectZones(d1Candles);
            result.d1Trend = d1Zones.structure?.trend || 'RANGING';
            result.d1Structure = d1Zones.structure;
        }

        // H4 structure
        if (h4Candles && h4Candles.length >= 10) {
            const h4Zones = smc.detectZones(h4Candles);
            result.h4Trend = h4Zones.structure?.trend || 'RANGING';
            result.h4Structure = h4Zones.structure;
            result.h4PD = h4Zones.premium_discount;
        }

        // Determine bias
        if (result.d1Trend === 'BULLISH' && result.h4Trend === 'BULLISH') {
            result.bias = 'BULLISH';
            result.strength = 3; // Strong — both agree
        } else if (result.d1Trend === 'BEARISH' && result.h4Trend === 'BEARISH') {
            result.bias = 'BEARISH';
            result.strength = 3;
        } else if (result.d1Trend === 'BULLISH' || result.h4Trend === 'BULLISH') {
            result.bias = 'BULLISH';
            result.strength = 1; // Weak — only one agrees
        } else if (result.d1Trend === 'BEARISH' || result.h4Trend === 'BEARISH') {
            result.bias = 'BEARISH';
            result.strength = 1;
        }

        // D1 overrides H4 in case of conflict
        if (result.d1Trend !== 'RANGING' && result.h4Trend !== 'RANGING' && 
            result.d1Trend !== result.h4Trend) {
            result.bias = result.d1Trend; // D1 wins
            result.strength = 0; // But low confidence due to conflict
            result.conflicting = true;
        }

        return result;
    }

    /**
     * MTF Analysis — Does H1 structure confirm the HTF bias?
     */
    analyzeMTF(symbol, h1Candles, htfBias) {
        const result = { confirmed: false, trend: 'RANGING', bos: false, choch: false, structure: null };

        if (!h1Candles || h1Candles.length < 10 || htfBias === 'NEUTRAL') {
            return result;
        }

        const h1Zones = smc.detectZones(h1Candles);
        result.structure = h1Zones.structure;
        result.trend = h1Zones.structure?.trend || 'RANGING';
        result.bos = h1Zones.structure?.bos || false;
        result.choch = h1Zones.structure?.choch || false;
        result.ob = h1Zones.ob;
        result.fvg = h1Zones.fvg;

        // Confirmation: H1 trend matches HTF bias AND has BOS
        if (htfBias === 'BULLISH' && result.trend === 'BULLISH' && result.bos) {
            result.confirmed = true;
        }
        if (htfBias === 'BEARISH' && result.trend === 'BEARISH' && result.bos) {
            result.confirmed = true;
        }

        // Also confirm on CHoCH if it's in the direction of HTF bias (reversal confirmation)
        if (htfBias === 'BULLISH' && result.choch && 
            result.structure?.lastCHoCH?.type === 'bullish_reversal') {
            result.confirmed = true;
        }
        if (htfBias === 'BEARISH' && result.choch && 
            result.structure?.lastCHoCH?.type === 'bearish_reversal') {
            result.confirmed = true;
        }

        return result;
    }

    /**
     * LTF Analysis — Is M15 showing entry readiness?
     */
    analyzeLTF(symbol, m15Candles, htfBias) {
        const result = { ready: false, entryType: 'NONE', poi: null };

        if (!m15Candles || m15Candles.length < 10 || htfBias === 'NEUTRAL') {
            return result;
        }

        const m15Zones = smc.detectZones(m15Candles);
        const structure = m15Zones.structure || {};
        const pd = m15Zones.premium_discount || {};

        // For BUY: Need LTF in discount zone with bullish evidence
        if (htfBias === 'BULLISH') {
            const inDiscount = pd.zone === 'DISCOUNT' || pd.zone === 'EQUILIBRIUM';
            const hasBullishOB = (m15Zones.ob || []).some(ob => ob.type === 'bullish');
            const hasBullishFVG = (m15Zones.fvg || []).some(f => f.type === 'bullish');
            const hasBOS = structure.bos && structure.lastBOS?.type === 'bullish';
            const hasSweep = (m15Zones.liquidity?.sweeps || []).some(s => s.type === 'bearish_sweep');

            if (inDiscount && (hasBullishOB || hasBullishFVG)) {
                result.ready = true;
                result.entryType = hasBullishOB ? 'OB_ENTRY' : 'FVG_ENTRY';
                result.poi = hasBullishOB ? m15Zones.ob.find(ob => ob.type === 'bullish') : 
                             m15Zones.fvg.find(f => f.type === 'bullish');
            }
            if (hasSweep) {
                result.ready = true;
                result.entryType = 'SWEEP_ENTRY';
            }
        }

        // For SELL: Need LTF in premium zone with bearish evidence
        if (htfBias === 'BEARISH') {
            const inPremium = pd.zone === 'PREMIUM' || pd.zone === 'EQUILIBRIUM';
            const hasBearishOB = (m15Zones.ob || []).some(ob => ob.type === 'bearish');
            const hasBearishFVG = (m15Zones.fvg || []).some(f => f.type === 'bearish');
            const hasSweep = (m15Zones.liquidity?.sweeps || []).some(s => s.type === 'bullish_sweep');

            if (inPremium && (hasBearishOB || hasBearishFVG)) {
                result.ready = true;
                result.entryType = hasBearishOB ? 'OB_ENTRY' : 'FVG_ENTRY';
                result.poi = hasBearishOB ? m15Zones.ob.find(ob => ob.type === 'bearish') :
                             m15Zones.fvg.find(f => f.type === 'bearish');
            }
            if (hasSweep) {
                result.ready = true;
                result.entryType = 'SWEEP_ENTRY';
            }
        }

        return result;
    }

    /**
     * Get MTF context string for LLM prompt injection
     */
    getContextForLLM(symbol, mtfResult) {
        if (!mtfResult) return '';

        let context = '\n=== MULTI-TIMEFRAME ANALYSIS ===\n';
        context += `HTF Bias: ${mtfResult.htfBias} (Strength: ${mtfResult.details?.htf?.strength || 0}/3)\n`;
        context += `  D1 Trend: ${mtfResult.details?.htf?.d1Trend || 'N/A'}\n`;
        context += `  H4 Trend: ${mtfResult.details?.htf?.h4Trend || 'N/A'}\n`;
        context += `MTF (H1) Confirmation: ${mtfResult.mtfConfirmation ? 'YES ✅' : 'NO ❌'}\n`;
        context += `  H1 Trend: ${mtfResult.details?.mtf?.trend || 'N/A'}\n`;
        context += `  H1 BOS: ${mtfResult.details?.mtf?.bos ? 'YES' : 'NO'}\n`;
        context += `LTF (M15) Entry Ready: ${mtfResult.ltfReady ? 'YES ✅' : 'NO ❌'}\n`;
        if (mtfResult.ltfReady) {
            context += `  Entry Type: ${mtfResult.details?.ltf?.entryType || 'N/A'}\n`;
        }
        context += `MTF Alignment: ${mtfResult.aligned ? 'FULL ✅' : 'PARTIAL'}\n`;
        context += `MTF Score Bonus: +${mtfResult.mtfScore}/3\n`;
        if (mtfResult.conflict) {
            context += `⚠️ TIMEFRAME CONFLICT: HTF and MTF disagree. Wait for resolution.\n`;
        }

        return context;
    }
}

module.exports = new MTFAnalysis();
