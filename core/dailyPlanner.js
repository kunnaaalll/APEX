/**
 * APEX Daily Planner & EOD Review v3.0
 * 
 * Like a professional trader's morning routine and evening journal.
 * 
 * Pre-Market (runs at session open):
 * - Reviews yesterday's performance
 * - Identifies today's key levels from HTF
 * - Sets focus pairs based on calendar + conditions
 * - Adjusts risk based on recent performance
 * 
 * End-of-Day (runs at session close):
 * - AI-powered trade review of the day
 * - Identifies patterns in wins/losses
 * - Updates trade intelligence rules
 * - Generates performance report
 */

const fs = require('fs');
const path = require('path');
const dashboard = require('../web/webDashboard');
const journal = require('../db/journal');
const aiRouter = require('../llm/aiRouter');
const accuracyGate = require('../eval/accuracyGate');
const newsFilter = require('./newsFilter');
const telegram = require('../notify/telegram');
const dailyTuner = require('./dailyTuner');

class DailyPlanner {
    constructor() {
        this.planPath = path.join(__dirname, '../data/daily_plan.json');
        this.reportPath = path.join(__dirname, '../data/daily_reports');
        
        // Ensure directories exist
        if (!fs.existsSync(this.reportPath)) {
            fs.mkdirSync(this.reportPath, { recursive: true });
        }

        this.todaysPlan = null;
        this.lastPlanDate = null;
        this.lastReviewDate = null;
        
        // Session times (UTC)
        this.sessions = {
            london: { open: 7, close: 16 },
            newyork: { open: 12, close: 21 },
            asia: { open: 23, close: 8 }
        };
    }

    /**
     * Run pre-market analysis — called automatically on first data of the day
     * or manually via dashboard
     */
    async runPreMarket() {
        const today = new Date().toISOString().split('T')[0];
        
        // Don't run twice on same day
        if (this.lastPlanDate === today) {
            return this.todaysPlan;
        }

        dashboard.logMessage('📋 DAILY PLANNER: Running pre-market analysis...', 'info');

        try {
            // 1. Get yesterday's performance
            const recentTrades = await this.getRecentTrades(1); // Last 1 day
            const dayStats = this.calculateDayStats(recentTrades);

            // 2. Get overall performance
            const overallStats = accuracyGate.stats;

            // 3. Get upcoming news events
            const newsStatus = newsFilter.getStatus();

            // 4. Generate AI plan (low priority — background task)
            let aiPlan = null;
            try {
                const prompt = this.buildPreMarketPrompt(dayStats, overallStats, newsStatus);
                const systemPrompt = `You are APEX's Daily Planner. You create focused, actionable trading plans.
Output JSON: { "focus_pairs": ["EURUSD", "GBPUSD"], "avoid_pairs": ["USDJPY"], "risk_level": "normal|reduced|minimal", "key_levels": {"EURUSD": {"support": 1.0850, "resistance": 1.0920}}, "session_focus": "london|newyork|both", "max_trades_today": 3, "notes": "Brief trading plan for today" }`;

                const result = await aiRouter.analyze(prompt, systemPrompt, { priority: 'low', maxTokens: 400 });
                if (result && result.focus_pairs) {
                    aiPlan = result;
                }
            } catch (e) {
                console.log('Daily Planner: AI plan skipped:', e.message);
            }

            // 5. Build today's plan
            this.todaysPlan = {
                date: today,
                timestamp: new Date().toISOString(),
                yesterdayStats: dayStats,
                overallStats: {
                    totalTrades: overallStats.totalTrades,
                    winRate: overallStats.winRate,
                    profitFactor: overallStats.profitFactor,
                    totalPnL: overallStats.totalPnL
                },
                upcomingNews: newsStatus.upcomingEvents || [],
                aiPlan: aiPlan || {
                    focus_pairs: ['EURUSD', 'GBPUSD', 'XAUUSD'],
                    risk_level: dayStats.pnl < 0 ? 'reduced' : 'normal',
                    max_trades_today: dayStats.losses >= 3 ? 2 : 3,
                    session_focus: 'both',
                    notes: 'Default plan — AI unavailable'
                },
                riskAdjustment: this.calculateRiskAdjustment(dayStats, overallStats)
            };

            // 6. Save plan
            fs.writeFileSync(this.planPath, JSON.stringify(this.todaysPlan, null, 2));
            this.lastPlanDate = today;

            // 7. Log to dashboard
            const plan = this.todaysPlan;
            dashboard.logMessage('━━━ DAILY PLAN ━━━', 'info');
            dashboard.logMessage(`📅 Date: ${today}`, 'info');
            dashboard.logMessage(`📊 Yesterday: ${dayStats.trades} trades | ${dayStats.wins}W ${dayStats.losses}L | PnL: $${dayStats.pnl.toFixed(2)}`, 'info');
            dashboard.logMessage(`🎯 Focus: ${plan.aiPlan.focus_pairs?.join(', ') || 'All pairs'}`, 'info');
            dashboard.logMessage(`⚖️ Risk: ${plan.aiPlan.risk_level || 'normal'} | Max trades: ${plan.aiPlan.max_trades_today || 3}`, 'info');
            if (plan.aiPlan.notes) dashboard.logMessage(`📝 ${plan.aiPlan.notes}`, 'info');
            dashboard.logMessage('━━━━━━━━━━━━━━', 'info');

            // 8. Send Telegram summary
            telegram.send(
                `📋 *APEX Daily Plan*\n` +
                `Date: ${today}\n` +
                `Yesterday: ${dayStats.wins}W/${dayStats.losses}L ($${dayStats.pnl.toFixed(2)})\n` +
                `Focus: ${plan.aiPlan.focus_pairs?.join(', ')}\n` +
                `Risk: ${plan.aiPlan.risk_level}\n` +
                `${plan.aiPlan.notes || ''}`
            ).catch(() => {});

            return this.todaysPlan;

        } catch (err) {
            console.error('Daily Planner Error:', err.message);
            dashboard.logMessage(`❌ Daily Planner Error: ${err.message}`, 'warn');
            return null;
        }
    }

    /**
     * Run end-of-day review — called at NY close or manually
     */
    async runEODReview() {
        const today = new Date().toISOString().split('T')[0];

        if (this.lastReviewDate === today) {
            dashboard.logMessage('EOD Review already completed today.', 'info');
            return;
        }

        dashboard.logMessage('📊 EOD REVIEW: Analyzing today\'s performance...', 'info');

        try {
            // 1. Get today's trades
            const todaysTrades = await this.getRecentTrades(0); // Today only
            const dayStats = this.calculateDayStats(todaysTrades);

            if (dayStats.trades === 0) {
                dashboard.logMessage('📊 EOD: No trades today.', 'info');
                this.lastReviewDate = today;
                return;
            }

            // 2. AI-powered review (what went right/wrong)
            let aiReview = null;
            try {
                const prompt = this.buildEODPrompt(todaysTrades, dayStats);
                const systemPrompt = `You are APEX's End-of-Day Reviewer. Analyze today's trades like a mentor.
Output JSON: { "grade": "A|B|C|D|F", "best_trade": "description of best trade", "worst_trade": "description of worst trade", "pattern_noticed": "recurring pattern in wins or losses", "rule_to_add": "specific rule to prevent repeat mistakes, or null", "tomorrow_advice": "what to do differently tomorrow" }`;

                const result = await aiRouter.analyze(prompt, systemPrompt, { priority: 'low', maxTokens: 400 });
                if (result && result.grade) {
                    aiReview = result;
                }
            } catch (e) {
                console.log('EOD Review: AI review skipped:', e.message);
            }

            // 3. Build report
            const report = {
                date: today,
                timestamp: new Date().toISOString(),
                stats: dayStats,
                trades: todaysTrades.map(t => ({
                    symbol: t.symbol,
                    direction: t.direction,
                    pnl: t.pnl,
                    outcome: t.outcome,
                    session: t.session,
                    confidence: t.confidence,
                    exit_reason: t.exit_reason
                })),
                aiReview: aiReview || { grade: 'N/A', tomorrow_advice: 'AI review unavailable' },
                plan: this.todaysPlan
            };

            // 4. Save report
            const reportFile = path.join(this.reportPath, `${today}.json`);
            fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

            // 5. If AI found a rule to add, save it to intelligence
            if (aiReview?.rule_to_add) {
                this.appendIntelligenceRule(aiReview.rule_to_add);
            }

            // 6. Log to dashboard
            dashboard.logMessage('━━━ EOD REVIEW ━━━', 'info');
            dashboard.logMessage(`📅 Date: ${today}`, 'info');
            dashboard.logMessage(`📊 Results: ${dayStats.trades} trades | ${dayStats.wins}W ${dayStats.losses}L | PnL: $${dayStats.pnl.toFixed(2)}`, 'info');
            dashboard.logMessage(`🎓 Grade: ${aiReview?.grade || 'N/A'}`, 'info');
            if (aiReview?.best_trade) dashboard.logMessage(`✅ Best: ${aiReview.best_trade}`, 'info');
            if (aiReview?.worst_trade) dashboard.logMessage(`❌ Worst: ${aiReview.worst_trade}`, 'info');
            if (aiReview?.pattern_noticed) dashboard.logMessage(`🔍 Pattern: ${aiReview.pattern_noticed}`, 'info');
            if (aiReview?.rule_to_add) dashboard.logMessage(`📏 New Rule: ${aiReview.rule_to_add}`, 'info');
            if (aiReview?.tomorrow_advice) dashboard.logMessage(`💡 Tomorrow: ${aiReview.tomorrow_advice}`, 'info');
            dashboard.logMessage('━━━━━━━━━━━━━━', 'info');

            // 7. Send Telegram
            telegram.send(
                `📊 *APEX EOD Review*\n` +
                `Date: ${today}\n` +
                `Trades: ${dayStats.wins}W/${dayStats.losses}L | PnL: $${dayStats.pnl.toFixed(2)}\n` +
                `Grade: ${aiReview?.grade || 'N/A'}\n` +
                `${aiReview?.pattern_noticed ? 'Pattern: ' + aiReview.pattern_noticed : ''}\n` +
                `${aiReview?.tomorrow_advice ? 'Tomorrow: ' + aiReview.tomorrow_advice : ''}`
            ).catch(() => {});

            // 8. Run statistical weight optimization for tomorrow
            await dailyTuner.tune();

            this.lastReviewDate = today;

        } catch (err) {
            console.error('EOD Review Error:', err.message);
            dashboard.logMessage(`❌ EOD Review Error: ${err.message}`, 'warn');
        }
    }

    // === HELPER METHODS ===

    async getRecentTrades(daysAgo = 0) {
        return new Promise((resolve, reject) => {
            const date = new Date();
            date.setDate(date.getDate() - daysAgo);
            const dateStr = date.toISOString().split('T')[0];

            journal.db.all(
                `SELECT * FROM trades WHERE status = 'CLOSED' AND date(timestamp) = ? ORDER BY timestamp DESC`,
                [dateStr],
                (err, rows) => {
                    if (err) { resolve([]); return; }
                    resolve(rows || []);
                }
            );
        });
    }

    calculateDayStats(trades) {
        const stats = {
            trades: trades.length,
            wins: 0,
            losses: 0,
            pnl: 0,
            avgWin: 0,
            avgLoss: 0,
            bestTrade: 0,
            worstTrade: 0,
            avgConfidence: 0,
            bySession: {}
        };

        if (trades.length === 0) return stats;

        let totalWinPnL = 0, totalLossPnL = 0, totalConfidence = 0;

        for (const t of trades) {
            const pnl = t.pnl || 0;
            stats.pnl += pnl;
            totalConfidence += t.confidence || 0;

            if (t.outcome === 'WIN') {
                stats.wins++;
                totalWinPnL += pnl;
                stats.bestTrade = Math.max(stats.bestTrade, pnl);
            } else {
                stats.losses++;
                totalLossPnL += pnl;
                stats.worstTrade = Math.min(stats.worstTrade, pnl);
            }

            // Track by session
            const session = t.session || 'unknown';
            if (!stats.bySession[session]) stats.bySession[session] = { wins: 0, losses: 0, pnl: 0 };
            stats.bySession[session].pnl += pnl;
            if (t.outcome === 'WIN') stats.bySession[session].wins++;
            else stats.bySession[session].losses++;
        }

        stats.avgWin = stats.wins > 0 ? totalWinPnL / stats.wins : 0;
        stats.avgLoss = stats.losses > 0 ? totalLossPnL / stats.losses : 0;
        stats.avgConfidence = totalConfidence / trades.length;

        return stats;
    }

    calculateRiskAdjustment(dayStats, overallStats) {
        let adjustment = 'normal';
        let multiplier = 1.0;
        const reasons = [];

        // After losing day, reduce risk
        if (dayStats.pnl < 0 && dayStats.losses >= 2) {
            adjustment = 'reduced';
            multiplier = 0.75;
            reasons.push('Losing day yesterday');
        }

        // After 3+ losing days in a row (check from overall stats)
        if (dayStats.losses >= 3 && dayStats.wins === 0) {
            adjustment = 'minimal';
            multiplier = 0.5;
            reasons.push('Bad day — all losses');
        }

        // If overall performance is declining
        if (overallStats.winRate < 40 && overallStats.totalTrades > 10) {
            adjustment = 'minimal';
            multiplier = 0.5;
            reasons.push(`Overall WR below 40% (${overallStats.winRate.toFixed(1)}%)`);
        }

        return { adjustment, multiplier, reasons };
    }

    buildPreMarketPrompt(dayStats, overallStats, newsStatus) {
        return `APEX Pre-Market Analysis.

YESTERDAY'S PERFORMANCE:
- Trades: ${dayStats.trades} | Wins: ${dayStats.wins} | Losses: ${dayStats.losses}
- PnL: $${dayStats.pnl.toFixed(2)}
- Best trade: $${dayStats.bestTrade.toFixed(2)} | Worst: $${dayStats.worstTrade.toFixed(2)}
- Avg confidence of entries: ${dayStats.avgConfidence.toFixed(0)}%

OVERALL PERFORMANCE (${overallStats.totalTrades} trades):
- Win Rate: ${overallStats.winRate.toFixed(1)}%
- Profit Factor: ${overallStats.profitFactor.toFixed(2)}
- Total PnL: $${overallStats.totalPnL.toFixed(2)}

UPCOMING NEWS: ${JSON.stringify(newsStatus.upcomingEvents?.slice(0, 5) || [])}

Based on this data, create today's trading plan. Focus on pairs with best recent performance. If yesterday was a losing day, recommend reduced risk.`;
    }

    buildEODPrompt(trades, dayStats) {
        const tradesSummary = trades.map(t => 
            `${t.symbol} ${t.direction}: ${t.outcome} $${(t.pnl || 0).toFixed(2)} | Conf: ${t.confidence}% | Exit: ${t.exit_reason} | Session: ${t.session}`
        ).join('\n');

        return `APEX End-of-Day Review.

TODAY'S TRADES:
${tradesSummary}

SUMMARY: ${dayStats.wins}W/${dayStats.losses}L | PnL: $${dayStats.pnl.toFixed(2)}

Analyze each trade. Look for patterns: Were losses from specific sessions? Were high-confidence trades more accurate? Did any trade violate good practices? Suggest one specific rule to prevent repeat mistakes.`;
    }

    appendIntelligenceRule(rule) {
        try {
            const intPath = path.join(__dirname, '../data/trade_intelligence.json');
            const data = JSON.parse(fs.readFileSync(intPath, 'utf8'));
            
            if (!data.dont_rules) data.dont_rules = [];
            
            // Don't duplicate
            if (data.dont_rules.includes(rule)) return;
            
            data.dont_rules.push(rule);
            
            // Keep last 50 rules
            if (data.dont_rules.length > 50) {
                data.dont_rules = data.dont_rules.slice(-50);
            }
            
            fs.writeFileSync(intPath, JSON.stringify(data, null, 2));
            dashboard.logMessage(`📏 Intelligence updated: "${rule}"`, 'info');
        } catch (e) {
            console.error('Intelligence update error:', e.message);
        }
    }

    /**
     * Get today's plan for other modules
     */
    getPlan() {
        return this.todaysPlan;
    }

    /**
     * Check if we should run scheduled tasks
     * Called periodically from apex.js
     */
    async checkScheduledTasks() {
        const now = new Date();
        const utcHour = now.getUTCHours();

        // Pre-market at London open (07:00 UTC)
        if (utcHour === 7 && this.lastPlanDate !== now.toISOString().split('T')[0]) {
            await this.runPreMarket();
        }

        // EOD review at NY close (21:00 UTC)
        if (utcHour === 21 && this.lastReviewDate !== now.toISOString().split('T')[0]) {
            await this.runEODReview();
        }
    }
}

module.exports = new DailyPlanner();
