/**
 * APEX ML Feedback Loop v2.0 — The Learning Brain
 * 
 * This is how the system reaches 70%+ accuracy.
 * Every closed trade becomes a structured lesson that feeds into future decisions.
 * 
 * Architecture:
 * Trade Closes → Assemble Review Packet → LLM Writes Structured Lesson → Store in DB
 *                                                                            ↓
 * Next Setup → Retrieve Last 20 Lessons → Inject into LLM Prompt → Better Decision
 */

const fs = require('fs');
const path = require('path');
const journal = require('../db/journal');
const dashboard = require('../web/webDashboard');
const openrouter = require('../llm/openrouter');
const accuracyGate = require('../eval/accuracyGate');

class MLLoop {
    constructor() {
        this.weightsPath = path.join(__dirname, '../data/ml_weights.json');
        this.intelligencePath = path.join(__dirname, '../data/trade_intelligence.json');
        this.init();
    }

    init() {
        const dataDir = path.dirname(this.weightsPath);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        if (!fs.existsSync(this.weightsPath)) {
            fs.writeFileSync(this.weightsPath, JSON.stringify({
                emaDifference: 1.0,
                rsiExtreme: 1.0,
                obPresence: 1.0,
                fvgPresence: 1.0,
                bosConfirm: 1.0,
                liquiditySweep: 1.0,
                premiumDiscount: 1.0,
                sessionWeight: 1.0,
                baseConfidence: 1.0
            }, null, 2));
        }

        if (!fs.existsSync(this.intelligencePath)) {
            fs.writeFileSync(this.intelligencePath, JSON.stringify({
                symbols: {},
                patterns: {},
                sessions: {},
                rules: [],
                doNotRules: [],
                totalLessons: 0,
                lastUpdated: new Date().toISOString()
            }, null, 2));
        }
    }

    getWeights() {
        try {
            return JSON.parse(fs.readFileSync(this.weightsPath, 'utf8'));
        } catch (e) {
            return { emaDifference: 1.0, rsiExtreme: 1.0, obPresence: 1.0, fvgPresence: 1.0, bosConfirm: 1.0, liquiditySweep: 1.0, premiumDiscount: 1.0, sessionWeight: 1.0, baseConfidence: 1.0 };
        }
    }

    getIntelligence() {
        try {
            return JSON.parse(fs.readFileSync(this.intelligencePath, 'utf8'));
        } catch (e) {
            return { symbols: {}, patterns: {}, sessions: {}, rules: [], doNotRules: [], totalLessons: 0 };
        }
    }

    /**
     * MAIN ENTRY: Process a closed trade through the full learning loop
     */
    async processClosedTrade(tradeDetails) {
        dashboard.logMessage(`🧠 ML Loop: Analyzing closed trade #${tradeDetails.ticket}...`);

        const actualPnL = parseFloat(tradeDetails.profit || 0);
        const win = actualPnL > 0;
        const outcome = win ? 'WIN' : (actualPnL < -10 ? 'LOSS' : 'BREAKEVEN');

        // 1. Find the original entry data from journal
        let entryData = await this.findEntryData(tradeDetails);

        // 2. Record to accuracy gate
        accuracyGate.recordTrade({
            symbol: tradeDetails.symbol,
            pnl: actualPnL,
            outcome,
            session: this.getCurrentSession(),
            timestamp: new Date().toISOString()
        });

        // 3. Record to DB
        await this.recordToDB(tradeDetails, outcome, actualPnL);

        // 4. Get LLM post-trade review (the real learning)
        const lesson = await this.getLLMReview(tradeDetails, entryData, outcome, actualPnL);

        // 5. Update intelligence weights
        this.updateWeights(tradeDetails, entryData, outcome, actualPnL);

        // 6. Update trade intelligence (per-symbol, per-session, patterns)
        this.updateIntelligence(tradeDetails, entryData, outcome, actualPnL, lesson);

        // 7. Store lesson in DB
        if (lesson) {
            await journal.storeLesson(tradeDetails.ticket, lesson);
            dashboard.logMessage(`🧠 Lesson stored: ${lesson.substring(0, 100)}...`);
        }

        // 8. Log summary
        const rr = entryData ? (Math.abs(entryData.entry - entryData.tp) / Math.abs(entryData.entry - entryData.sl)).toFixed(2) : 'N/A';
        dashboard.logMessage(
            `📋 Trade #${tradeDetails.ticket} Summary: ${outcome} | PnL: $${actualPnL.toFixed(2)} | ` +
            `R:R: ${rr} | MFE: $${(tradeDetails.max_favorable_excursion || 0).toFixed(2)} | ` +
            `MAE: $${(tradeDetails.max_adverse_excursion || 0).toFixed(2)}`
        );
    }

    /**
     * Find original entry data from the journal
     */
    async findEntryData(tradeDetails) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../db/journal.json'), 'utf8'));
            const matching = data.trades
                .filter(t => t.symbol === tradeDetails.symbol)
                .reverse();
            return matching.length > 0 ? matching[0] : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Record trade to SQLite database
     */
    async recordToDB(tradeDetails, outcome, pnl) {
        try {
            const stmt = journal.db.prepare(
                `INSERT INTO trades (symbol, direction, entry_price, sl, tp, status, outcome, pnl, session, mfe, mae, exit_reason, confidence) 
                 VALUES (?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?, ?, ?)`
            );
            const direction = tradeDetails.type === 0 ? 'BUY' : 'SELL';
            stmt.run(
                tradeDetails.symbol,
                direction,
                tradeDetails.price_open || 0,
                tradeDetails.sl || 0,
                tradeDetails.tp || 0,
                outcome,
                pnl,
                this.getCurrentSession(),
                tradeDetails.max_favorable_excursion || 0,
                tradeDetails.max_adverse_excursion || 0,
                'AUTO', // exit reason
                0       // confidence (if available)
            );
            stmt.finalize();
        } catch (e) {
            console.error('ML Loop DB Error:', e.message);
        }
    }

    /**
     * Get LLM post-trade review — the core learning mechanism
     */
    async getLLMReview(tradeDetails, entryData, outcome, pnl) {
        try {
            const recentLessons = await journal.getRecentLessons(10);

            const prompt = `
TRADE POST-MORTEM ANALYSIS

Trade Details:
- Symbol: ${tradeDetails.symbol}
- Direction: ${tradeDetails.type === 0 ? 'BUY' : 'SELL'}
- Entry: ${tradeDetails.price_open || 'N/A'}
- SL: ${tradeDetails.sl || 'N/A'}
- TP: ${tradeDetails.tp || 'N/A'}
- Outcome: ${outcome}
- PnL: $${pnl.toFixed(2)}
- Max Favorable Excursion: $${(tradeDetails.max_favorable_excursion || 0).toFixed(2)}
- Max Adverse Excursion: $${(tradeDetails.max_adverse_excursion || 0).toFixed(2)}
${entryData ? `- Original Confidence: ${entryData.confidence || 'N/A'}%
- Original Rationale: ${entryData.rationale || 'N/A'}
- Indicators at entry: RSI=${entryData.indicators?.rsi || 'N/A'}, EMA20=${entryData.indicators?.ema20 || 'N/A'}
- ATR at entry: ${entryData.atr || 'N/A'}
- Zones: OB=${JSON.stringify(entryData.zones?.ob?.length || 0)}, FVG=${JSON.stringify(entryData.zones?.fvg?.length || 0)}` : ''}

Recent Lessons from Past Trades:
${recentLessons.length > 0 ? recentLessons.map((l, i) => `${i + 1}. ${l}`).join('\n') : 'No previous lessons yet.'}

Write a concise, actionable lesson in this format:
1. CATEGORY: (ENTRY_TIMING | SL_PLACEMENT | TP_PLACEMENT | DIRECTION | MARKET_CONTEXT | PATTERN_QUALITY)
2. WHAT_HAPPENED: One sentence about what price did
3. WHAT_WAS_RIGHT: What the analysis got correct
4. WHAT_WAS_WRONG: What the analysis missed or got wrong
5. DO_NEXT_TIME: One specific, actionable rule to follow
6. DO_NOT: One specific thing to avoid

Respond as a single paragraph combining all points. Be specific with numbers.`;

            const systemPrompt = `You are an elite trading mentor with 20 years of experience. 
Your job is to analyze closed trades and extract ONE actionable lesson. 
Be brutally honest. Focus on what can be improved.
If the trade was a win, still find what could be done better.
If the MFE was much higher than actual profit, note the trade management issue.
If the MAE was close to the SL, note the entry quality issue.
Keep lessons under 200 words. Be specific, not generic.`;

            const result = await openrouter.analyze(prompt, systemPrompt);
            return result?.rationale || result?.lesson || null;
        } catch (e) {
            console.error('ML Loop LLM Review Error:', e.message);
            return null;
        }
    }

    /**
     * Update numerical weights based on trade outcome
     */
    updateWeights(tradeDetails, entryData, outcome, pnl) {
        if (!entryData || !entryData.indicators) return;

        let weights = this.getWeights();
        let modified = false;

        const learnRate = 0.05; // Conservative learning rate
        const winMultiplier = 1 + learnRate;
        const lossMultiplier = 1 - learnRate;

        if (outcome === 'LOSS') {
            // Penalize conditions that led to loss
            if (entryData.indicators.rsi < 30 || entryData.indicators.rsi > 70) {
                weights.rsiExtreme = Math.max(0.1, weights.rsiExtreme * lossMultiplier);
                modified = true;
            }
            if (entryData.zones?.ob?.length > 0) {
                weights.obPresence = Math.max(0.1, weights.obPresence * (1 - learnRate * 0.5));
                modified = true;
            }
            if (entryData.zones?.fvg?.length > 0) {
                weights.fvgPresence = Math.max(0.1, weights.fvgPresence * (1 - learnRate * 0.5));
                modified = true;
            }
            weights.baseConfidence = Math.max(0.5, weights.baseConfidence * (1 - learnRate * 0.3));
            modified = true;

        } else if (outcome === 'WIN') {
            // Reward conditions that led to win
            if (entryData.indicators.rsi < 30 || entryData.indicators.rsi > 70) {
                weights.rsiExtreme = Math.min(2.0, weights.rsiExtreme * winMultiplier);
                modified = true;
            }
            if (entryData.zones?.ob?.length > 0) {
                weights.obPresence = Math.min(2.0, weights.obPresence * (1 + learnRate * 0.5));
                modified = true;
            }
            if (entryData.zones?.fvg?.length > 0) {
                weights.fvgPresence = Math.min(2.0, weights.fvgPresence * (1 + learnRate * 0.5));
                modified = true;
            }
            weights.baseConfidence = Math.min(1.5, weights.baseConfidence * (1 + learnRate * 0.2));
            modified = true;
        }

        if (modified) {
            fs.writeFileSync(this.weightsPath, JSON.stringify(weights, null, 2));
            dashboard.logMessage(`⚙️ ML Weights Updated: OB=${weights.obPresence.toFixed(2)} FVG=${weights.fvgPresence.toFixed(2)} RSI=${weights.rsiExtreme.toFixed(2)} Base=${weights.baseConfidence.toFixed(2)}`);
        }
    }

    /**
     * Update trade intelligence — per-symbol, per-session, per-pattern tracking
     */
    updateIntelligence(tradeDetails, entryData, outcome, pnl, lesson) {
        let intel = this.getIntelligence();
        const symbol = tradeDetails.symbol;
        const session = this.getCurrentSession();

        // Per-symbol intelligence
        if (!intel.symbols[symbol]) {
            intel.symbols[symbol] = { trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0, bestSession: '', avgPnL: 0, sessions: {} };
        }
        const sym = intel.symbols[symbol];
        sym.trades++;
        if (outcome === 'WIN') sym.wins++;
        else if (outcome === 'LOSS') sym.losses++;
        sym.pnl += pnl;
        sym.winRate = (sym.wins + sym.losses) > 0 ? ((sym.wins / (sym.wins + sym.losses)) * 100).toFixed(1) : 0;
        sym.avgPnL = (sym.pnl / sym.trades).toFixed(2);

        // Per-symbol-session tracking
        if (!sym.sessions[session]) sym.sessions[session] = { trades: 0, wins: 0, losses: 0 };
        sym.sessions[session].trades++;
        if (outcome === 'WIN') sym.sessions[session].wins++;
        else if (outcome === 'LOSS') sym.sessions[session].losses++;

        // Determine best session for this symbol
        let bestSession = '';
        let bestWinRate = 0;
        for (const [ses, stats] of Object.entries(sym.sessions)) {
            const wr = (stats.wins + stats.losses) > 0 ? stats.wins / (stats.wins + stats.losses) : 0;
            if (wr > bestWinRate && stats.trades >= 3) {
                bestWinRate = wr;
                bestSession = ses;
            }
        }
        sym.bestSession = bestSession;

        // Per-session intelligence
        if (!intel.sessions[session]) {
            intel.sessions[session] = { trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0 };
        }
        const ses = intel.sessions[session];
        ses.trades++;
        if (outcome === 'WIN') ses.wins++;
        else if (outcome === 'LOSS') ses.losses++;
        ses.pnl += pnl;
        ses.winRate = (ses.wins + ses.losses) > 0 ? ((ses.wins / (ses.wins + ses.losses)) * 100).toFixed(1) : 0;

        // Pattern tracking
        if (entryData && entryData.zones) {
            const patternKey = this.getPatternKey(entryData);
            if (!intel.patterns[patternKey]) {
                intel.patterns[patternKey] = { trades: 0, wins: 0, losses: 0, winRate: 0 };
            }
            intel.patterns[patternKey].trades++;
            if (outcome === 'WIN') intel.patterns[patternKey].wins++;
            else if (outcome === 'LOSS') intel.patterns[patternKey].losses++;
            const pp = intel.patterns[patternKey];
            pp.winRate = (pp.wins + pp.losses) > 0 ? ((pp.wins / (pp.wins + pp.losses)) * 100).toFixed(1) : 0;
        }

        // Extract DO NOT rules from losses
        if (outcome === 'LOSS' && lesson) {
            const doNotRule = {
                rule: lesson,
                source: `trade_${tradeDetails.ticket}`,
                symbol,
                session,
                timestamp: new Date().toISOString()
            };
            intel.doNotRules.push(doNotRule);
            // Keep only last 50 DO NOT rules
            if (intel.doNotRules.length > 50) intel.doNotRules.shift();
        }

        // Extract positive rules from wins
        if (outcome === 'WIN' && lesson) {
            const doRule = {
                rule: lesson,
                source: `trade_${tradeDetails.ticket}`,
                symbol,
                session,
                timestamp: new Date().toISOString()
            };
            intel.rules.push(doRule);
            if (intel.rules.length > 50) intel.rules.shift();
        }

        intel.totalLessons++;
        intel.lastUpdated = new Date().toISOString();

        fs.writeFileSync(this.intelligencePath, JSON.stringify(intel, null, 2));
    }

    /**
     * Generate a pattern key from entry data
     */
    getPatternKey(entryData) {
        const parts = [];
        if (entryData.zones?.ob?.length > 0) {
            parts.push(entryData.zones.ob[0].type === 'bullish' ? 'bullish_ob' : 'bearish_ob');
        }
        if (entryData.zones?.fvg?.length > 0) {
            parts.push('fvg');
        }
        if (entryData.zones?.structure?.bos) parts.push('bos');
        if (entryData.zones?.structure?.choch) parts.push('choch');
        if (entryData.indicators?.rsi < 30) parts.push('oversold');
        if (entryData.indicators?.rsi > 70) parts.push('overbought');

        return parts.length > 0 ? parts.join('_') : 'unknown_pattern';
    }

    /**
     * Get lessons formatted for LLM prompt injection
     * This is the KEY to the learning system
     */
    async getLessonsForPrompt(symbol) {
        const intel = this.getIntelligence();
        const lessons = await journal.getRecentLessons(20);

        let context = '';

        // 1. Recent lessons
        if (lessons.length > 0) {
            context += '\n=== LESSONS FROM PAST TRADES (LEARN FROM THESE) ===\n';
            lessons.forEach((l, i) => { context += `${i + 1}. ${l}\n`; });
        }

        // 2. Symbol-specific intelligence
        if (intel.symbols[symbol]) {
            const sym = intel.symbols[symbol];
            context += `\n=== ${symbol} SPECIFIC INTELLIGENCE ===\n`;
            context += `Win Rate: ${sym.winRate}% over ${sym.trades} trades\n`;
            context += `Average PnL: $${sym.avgPnL}\n`;
            context += `Best Session: ${sym.bestSession || 'insufficient data'}\n`;
            if (sym.sessions) {
                for (const [ses, stats] of Object.entries(sym.sessions)) {
                    const wr = (stats.wins + stats.losses) > 0 ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(0) : 'N/A';
                    context += `  ${ses}: ${wr}% WR (${stats.trades} trades)\n`;
                }
            }
        }

        // 3. Current session stats
        const currentSession = this.getCurrentSession();
        if (intel.sessions[currentSession]) {
            const ses = intel.sessions[currentSession];
            context += `\n=== CURRENT SESSION (${currentSession}) PERFORMANCE ===\n`;
            context += `Win Rate: ${ses.winRate}% over ${ses.trades} trades\n`;
        }

        // 4. DO NOT rules (critical for avoiding repeated mistakes)
        if (intel.doNotRules.length > 0) {
            context += `\n=== DO NOT RULES (LEARNED FROM LOSSES — FOLLOW STRICTLY) ===\n`;
            const relevantRules = intel.doNotRules
                .filter(r => !r.symbol || r.symbol === symbol)
                .slice(-10);
            relevantRules.forEach((r, i) => { context += `❌ ${i + 1}. ${r.rule}\n`; });
        }

        // 5. Pattern performance
        if (Object.keys(intel.patterns).length > 0) {
            context += `\n=== PATTERN PERFORMANCE ===\n`;
            for (const [pattern, stats] of Object.entries(intel.patterns)) {
                if (stats.trades >= 3) {
                    context += `${pattern}: ${stats.winRate}% WR (${stats.trades} trades)\n`;
                }
            }
        }

        // 6. Overall performance context
        const overallStats = accuracyGate.getStatsForLLM();
        context += `\n=== OVERALL PERFORMANCE ===\n`;
        context += `Total: ${overallStats.totalTrades} trades | Win Rate: ${overallStats.winRate}% | PF: ${overallStats.profitFactor} | Avg RR: ${overallStats.avgRR}\n`;
        context += `Current Streak: ${overallStats.currentStreak}\n`;

        return context;
    }

    getCurrentSession() {
        const hour = new Date().getUTCHours();
        if (hour >= 7 && hour < 12) return 'london';
        if (hour >= 12 && hour < 16) return 'ny_overlap';
        if (hour >= 16 && hour < 20) return 'ny';
        if (hour >= 0 && hour < 7) return 'asian';
        return 'off_hours';
    }
}

module.exports = new MLLoop();
