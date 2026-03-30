/**
 * APEX Risk Guard System
 * 
 * Acts like a 20-year experienced trader's risk management discipline.
 * Controls WHEN to trade, HOW MUCH to risk, and WHEN to stop.
 * 
 * Rules enforced:
 * 1. Daily loss limit (3% of account)
 * 2. Consecutive loss guard (reduce size after 3 losses)
 * 3. Losing streak cooldown (pause after 5 losses)
 * 4. Correlation guard (no duplicate base-currency trades)
 * 5. Max open trades (cap at 3)
 * 6. Session quality filter
 * 7. Drawdown circuit breaker
 */

require('dotenv').config();
const dashboard = require('../web/webDashboard');

class RiskGuard {
    constructor() {
        this.dailyPnL = 0;
        this.dailyTradeCount = 0;
        this.consecutiveLosses = 0;
        this.consecutiveWins = 0;
        this.lastTradeTime = 0;
        this.cooldownUntil = 0;
        this.openPositions = {};
        this.todayDate = new Date().toISOString().split('T')[0];

        // Config from .env
        this.maxDailyLossPercent = parseFloat(process.env.DAILY_LOSS_LIMIT || 3);
        this.maxSimultaneousTrades = parseInt(process.env.MAX_SIMULTANEOUS_TRADES || 3);
        this.riskPercent = parseFloat(process.env.DEFAULT_RISK_PERCENT || 1);
        this.maxDrawdownPercent = parseFloat(process.env.MAX_DRAWDOWN_THRESHOLD || 15);

        // Account state
        this.accountBalance = 10000;
        this.accountEquity = 10000;
        this.peakEquity = 10000;
    }

    /**
     * Update account info from MT5 bridge
     */
    updateAccount(info) {
        if (!info) return;
        this.accountBalance = parseFloat(info.balance) || this.accountBalance;
        this.accountEquity = parseFloat(info.equity) || this.accountEquity;
        if (this.accountEquity > this.peakEquity) {
            this.peakEquity = this.accountEquity;
        }
    }

    /**
     * Update known open positions
     */
    updatePositions(positions) {
        if (!positions) return;
        this.openPositions = {};
        for (const p of positions) {
            this.openPositions[p.ticket] = p;
        }
    }

    /**
     * Reset daily counters at midnight
     */
    checkDayReset() {
        const today = new Date().toISOString().split('T')[0];
        if (today !== this.todayDate) {
            dashboard.logMessage(`📅 New trading day: ${today}. Resetting daily counters.`);
            this.dailyPnL = 0;
            this.dailyTradeCount = 0;
            this.todayDate = today;
        }
    }

    /**
     * Record a closed trade result for risk tracking
     */
    recordTradeResult(pnl) {
        this.dailyPnL += pnl;
        this.dailyTradeCount++;

        if (pnl > 0) {
            this.consecutiveWins++;
            this.consecutiveLosses = 0;
        } else if (pnl < 0) {
            this.consecutiveLosses++;
            this.consecutiveWins = 0;
        }

        // Losing streak cooldown
        if (this.consecutiveLosses >= 5) {
            this.cooldownUntil = Date.now() + (60 * 60 * 1000); // 1 hour
            dashboard.logMessage(`⛔ LOSING STREAK: ${this.consecutiveLosses} consecutive losses. Cooling down for 1 hour.`, 'warn');
        }

        this.lastTradeTime = Date.now();
    }

    /**
     * MASTER GATE: Can we take a new trade?
     * Returns { allowed: bool, reason: string, adjustments: {} }
     */
    canTrade(symbol, direction) {
        this.checkDayReset();

        const checks = [
            this.checkDailyLossLimit(),
            this.checkCooldown(),
            this.checkMaxOpenTrades(),
            this.checkCorrelation(symbol),
            this.checkDrawdown(),
            this.checkSessionQuality(),
            this.checkMinTimeBetweenTrades(),
            this.checkWeekendClose()
        ];

        for (const check of checks) {
            if (!check.allowed) {
                dashboard.logMessage(`🛡️ RISK GUARD BLOCKED: ${check.reason}`, 'warn');
                return check;
            }
        }

        // Calculate position size adjustments
        const adjustments = this.calculateAdjustments();

        return {
            allowed: true,
            reason: 'All risk checks passed',
            adjustments
        };
    }

    /**
     * Check 1: Daily loss limit
     */
    checkDailyLossLimit() {
        const maxLoss = this.accountBalance * (this.maxDailyLossPercent / 100);
        if (this.dailyPnL < -maxLoss) {
            return {
                allowed: false,
                reason: `Daily loss limit hit: $${this.dailyPnL.toFixed(2)} (max: -$${maxLoss.toFixed(2)}). No more trades today.`
            };
        }
        return { allowed: true };
    }

    /**
     * Check 2: Cooldown after losing streak
     */
    checkCooldown() {
        if (Date.now() < this.cooldownUntil) {
            const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 60000);
            return {
                allowed: false,
                reason: `Losing streak cooldown active. ${remaining} minutes remaining.`
            };
        }
        return { allowed: true };
    }

    /**
     * Check 3: Max simultaneous open trades
     */
    checkMaxOpenTrades() {
        const openCount = Object.keys(this.openPositions).length;
        if (openCount >= this.maxSimultaneousTrades) {
            return {
                allowed: false,
                reason: `Max open trades reached: ${openCount}/${this.maxSimultaneousTrades}`
            };
        }
        return { allowed: true };
    }

    /**
     * Check 4: Correlation guard
     * No two trades on same base currency
     */
    checkCorrelation(symbol) {
        if (!symbol) return { allowed: true };

        // Extract base and quote currencies
        const base = symbol.substring(0, 3);
        const quote = symbol.substring(3, 6);

        for (const ticket in this.openPositions) {
            const pos = this.openPositions[ticket];
            const posBase = (pos.symbol || '').substring(0, 3);
            const posQuote = (pos.symbol || '').substring(3, 6);

            // Same symbol check
            if (pos.symbol === symbol) {
                return {
                    allowed: false,
                    reason: `Already have an open position on ${symbol}`
                };
            }

            // Correlation check (same base currency in same direction)
            if (base === posBase || base === posQuote || quote === posBase) {
                // Allow if it's a hedge (opposite direction), block if same direction
                return {
                    allowed: false,
                    reason: `Correlation guard: ${symbol} conflicts with open ${pos.symbol} trade. Same currency exposure.`
                };
            }
        }
        return { allowed: true };
    }

    /**
     * Check 5: Drawdown circuit breaker
     */
    checkDrawdown() {
        if (this.peakEquity <= 0) return { allowed: true };

        const drawdown = ((this.peakEquity - this.accountEquity) / this.peakEquity) * 100;
        if (drawdown > this.maxDrawdownPercent) {
            return {
                allowed: false,
                reason: `Drawdown circuit breaker: ${drawdown.toFixed(1)}% drawdown exceeds ${this.maxDrawdownPercent}% limit.`
            };
        }
        return { allowed: true };
    }

    /**
     * Check 6: Session quality filter
     * Higher confidence required during low-quality sessions
     */
    checkSessionQuality() {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const dayOfWeek = now.getUTCDay();

        // No trading on weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return {
                allowed: false,
                reason: 'Weekend — markets closed.'
            };
        }

        // Very low quality during dead hours (20:00 - 00:00 UTC)
        if (utcHour >= 20 && utcHour <= 23) {
            return {
                allowed: false,
                reason: 'Off-hours (20:00-00:00 UTC) — low liquidity, no trading.'
            };
        }

        return { allowed: true };
    }

    /**
     * Check 7: Minimum time between trades (prevent rapid-fire entries)
     */
    checkMinTimeBetweenTrades() {
        const minGap = 5 * 60 * 1000; // 5 minutes minimum
        if (Date.now() - this.lastTradeTime < minGap) {
            return {
                allowed: false,
                reason: 'Minimum 5 minutes between trades. Preventing impulse entries.'
            };
        }
        return { allowed: true };
    }

    /**
     * Check 8: Weekend close check
     */
    checkWeekendClose() {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const utcHour = now.getUTCHours();

        // Friday after 20:00 UTC — don't open new trades
        if (dayOfWeek === 5 && utcHour >= 20) {
            return {
                allowed: false,
                reason: 'Friday close approaching. No new trades after 20:00 UTC.'
            };
        }
        return { allowed: true };
    }

    /**
     * Calculate position size adjustments based on performance
     */
    calculateAdjustments() {
        let riskMultiplier = 1.0;
        let reason = 'Standard risk';

        // Reduce risk after consecutive losses
        if (this.consecutiveLosses >= 3) {
            riskMultiplier = 0.5;
            reason = `Reduced risk (${this.consecutiveLosses} consecutive losses)`;
        } else if (this.consecutiveLosses >= 2) {
            riskMultiplier = 0.75;
            reason = `Slightly reduced risk (${this.consecutiveLosses} consecutive losses)`;
        }

        // Slight increase on winning streak (max 1.25x)
        if (this.consecutiveWins >= 5) {
            riskMultiplier = Math.min(riskMultiplier * 1.25, 1.25);
            reason = `Winning streak bonus (${this.consecutiveWins} consecutive wins)`;
        }

        return {
            riskMultiplier,
            adjustedRiskPercent: this.riskPercent * riskMultiplier,
            reason,
            consecutiveLosses: this.consecutiveLosses,
            consecutiveWins: this.consecutiveWins,
            dailyPnL: this.dailyPnL,
            openTradeCount: Object.keys(this.openPositions).length
        };
    }

    /**
     * Get a full risk status report
     */
    getStatus() {
        const drawdown = this.peakEquity > 0
            ? ((this.peakEquity - this.accountEquity) / this.peakEquity * 100).toFixed(2)
            : 0;

        return {
            dailyPnL: this.dailyPnL.toFixed(2),
            dailyTradeCount: this.dailyTradeCount,
            consecutiveWins: this.consecutiveWins,
            consecutiveLosses: this.consecutiveLosses,
            openTradeCount: Object.keys(this.openPositions).length,
            maxOpenTrades: this.maxSimultaneousTrades,
            currentDrawdown: `${drawdown}%`,
            maxDrawdown: `${this.maxDrawdownPercent}%`,
            cooldownActive: Date.now() < this.cooldownUntil,
            accountBalance: this.accountBalance,
            accountEquity: this.accountEquity
        };
    }
}

module.exports = new RiskGuard();
