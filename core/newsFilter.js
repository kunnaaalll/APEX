/**
 * APEX News Filter — Economic Calendar Event Filter
 * 
 * Uses MT5's built-in economic calendar data (sent via bridge) 
 * to protect trades from high-impact news events.
 * 
 * Completely free — no external API needed.
 * 
 * Rules:
 * 1. No new trades within 30 min of HIGH impact news for affected currencies
 * 2. No entries for 15 min after HIGH news (let volatility settle)
 * 3. NFP/FOMC/CPI: Close positions 60 min before, no trading until 30 min after
 * 4. Tighten SL to breakeven on profitable trades before HIGH news
 * 5. If spread >3x normal during news → block all entries
 */

const dashboard = require('../web/webDashboard');

class NewsFilter {
    constructor() {
        // Current calendar events received from MT5
        this.upcomingEvents = [];
        this.recentEvents = []; // Events that recently occurred (for post-news cooldown)
        
        // Currency mapping for symbols
        this.symbolCurrencies = {
            'EURUSD': ['EUR', 'USD'],
            'GBPUSD': ['GBP', 'USD'],
            'USDJPY': ['USD', 'JPY'],
            'XAUUSD': ['XAU', 'USD'],
            'AUDUSD': ['AUD', 'USD'],
            'USDCHF': ['USD', 'CHF'],
            'USDCAD': ['USD', 'CAD'],
            'NZDUSD': ['NZD', 'USD'],
            'EURGBP': ['EUR', 'GBP'],
            'EURJPY': ['EUR', 'JPY'],
            'GBPJPY': ['GBP', 'JPY']
        };

        // Critical events that warrant full position closure
        this.criticalEvents = [
            'Non-Farm Payrolls', 'NFP', 'Nonfarm Payrolls',
            'FOMC', 'Federal Funds Rate', 'Fed Interest Rate',
            'CPI', 'Consumer Price Index',
            'ECB Interest Rate', 'ECB Rate',
            'BOE Interest Rate', 'BOE Rate',
            'BOJ Interest Rate', 'BOJ Rate',
            'GDP', 'Gross Domestic Product'
        ];

        // ⚛️ ARIA V15.5 GFT COMPLIANCE: Extended lockout windows
        this.preNewsLockout = 35 * 60 * 1000;     // 35 min (GFT rule is 5 min, we use 35 for safety)
        this.postNewsCooldown = 20 * 60 * 1000;   // 20 min after HIGH news
        this.criticalLockout = 60 * 60 * 1000;    // 60 min before CRITICAL news
        this.criticalCooldown = 45 * 60 * 1000;   // 45 min after CRITICAL news

        this.lastLogTime = 0;
    }

    /**
     * Update calendar events from MT5 bridge data
     * Called every time the bridge sends an update
     */
    updateEvents(events) {
        if (!events || !Array.isArray(events)) return;
        
        const now = Date.now();
        
        // Separate upcoming and recent events
        this.upcomingEvents = events.filter(e => {
            const eventTime = e.time * 1000; // MT5 sends Unix timestamp in seconds
            return eventTime > now;
        });

        this.recentEvents = events.filter(e => {
            const eventTime = e.time * 1000;
            const timeSince = now - eventTime;
            return timeSince >= 0 && timeSince < this.postNewsCooldown;
        });

        // Log upcoming high-impact events periodically (every 5 min)
        if (now - this.lastLogTime > 300000) {
            const highImpact = this.upcomingEvents.filter(e => 
                e.importance === 'HIGH' || e.importance === 3 || this.isCriticalEvent(e.name)
            );
            if (highImpact.length > 0) {
                dashboard.logMessage(`📰 News Filter: ${highImpact.length} upcoming high-impact events: ${
                    highImpact.map(e => `${e.currency} ${e.name} (${this.formatTimeUntil(e.time * 1000 - now)})`).join(', ')
                }`);
            }
            this.lastLogTime = now;
        }
    }

    /**
     * MAIN CHECK: Can we trade this symbol given upcoming news?
     * Returns { allowed: bool, reason: string, action: string }
     */
    canTrade(symbol) {
        const currencies = this.getCurrenciesForSymbol(symbol);
        if (currencies.length === 0) return { allowed: true, reason: 'Symbol not tracked for news' };

        const now = Date.now();

        // Check upcoming events
        for (const event of this.upcomingEvents) {
            if (!currencies.includes(event.currency)) continue;

            const eventTime = event.time * 1000;
            const timeUntil = eventTime - now;
            const isCritical = this.isCriticalEvent(event.name);
            const isHigh = event.importance === 'HIGH' || event.importance === 3 || isCritical;

            if (!isHigh) continue;

            // CRITICAL event lockout (60 min)
            if (isCritical && timeUntil > 0 && timeUntil <= this.criticalLockout) {
                return {
                    allowed: false,
                    reason: `⛔ CRITICAL NEWS: ${event.currency} ${event.name} in ${this.formatTimeUntil(timeUntil)}. All trading paused.`,
                    action: 'CLOSE_ALL', // Signal to trade manager to close affected positions
                    event: event.name,
                    currency: event.currency,
                    timeUntil
                };
            }

            // HIGH impact lockout (30 min)
            if (isHigh && timeUntil > 0 && timeUntil <= this.preNewsLockout) {
                return {
                    allowed: false,
                    reason: `📰 HIGH NEWS: ${event.currency} ${event.name} in ${this.formatTimeUntil(timeUntil)}. No new trades.`,
                    action: 'TIGHTEN_SL',
                    event: event.name,
                    currency: event.currency,
                    timeUntil
                };
            }
        }

        // Check post-news cooldown
        for (const event of this.recentEvents) {
            if (!currencies.includes(event.currency)) continue;

            const eventTime = event.time * 1000;
            const timeSince = now - eventTime;
            const isCritical = this.isCriticalEvent(event.name);
            const isHigh = event.importance === 'HIGH' || event.importance === 3 || isCritical;

            if (!isHigh) continue;

            const cooldown = isCritical ? this.criticalCooldown : this.postNewsCooldown;
            if (timeSince < cooldown) {
                const remaining = cooldown - timeSince;
                return {
                    allowed: false,
                    reason: `📰 POST-NEWS COOLDOWN: ${event.currency} ${event.name} occurred ${this.formatTimeUntil(timeSince)} ago. Cooling down for ${this.formatTimeUntil(remaining)}.`,
                    action: 'WAIT',
                    event: event.name,
                    currency: event.currency
                };
            }
        }

        // Calculate news proximity score for confluence adjustment
        return { 
            allowed: true, 
            reason: 'No impactful news nearby',
            newsProximityScore: this.getNewsProximityScore(currencies)
        };
    }

    /**
     * Get news proximity score for confluence adjustment
     * -1 to 0: Negative (news nearby, reduce confluence), 0: neutral
     */
    getNewsProximityScore(currencies) {
        const now = Date.now();
        let closestHighNews = Infinity;

        for (const event of this.upcomingEvents) {
            if (!currencies.includes(event.currency)) continue;
            const isHigh = event.importance === 'HIGH' || event.importance === 3;
            if (!isHigh) continue;
            
            const timeUntil = (event.time * 1000) - now;
            if (timeUntil > 0 && timeUntil < closestHighNews) {
                closestHighNews = timeUntil;
            }
        }

        // No high news nearby → neutral
        if (closestHighNews === Infinity || closestHighNews > 2 * 60 * 60 * 1000) return 0;

        // High news within 2 hours → gradual penalty
        // 2 hours → -0.1 confluence, 30 min → -1.0 confluence
        const hoursUntil = closestHighNews / (60 * 60 * 1000);
        return Math.max(-1, -(1 - hoursUntil / 2));
    }

    /**
     * Should we protect active trades? (Called by trade manager)
     * Returns list of currencies that have imminent high-impact news
     */
    getCurrenciesAtRisk() {
        const now = Date.now();
        const atRisk = [];

        for (const event of this.upcomingEvents) {
            const timeUntil = (event.time * 1000) - now;
            const isHigh = event.importance === 'HIGH' || event.importance === 3 || this.isCriticalEvent(event.name);
            
            if (isHigh && timeUntil > 0 && timeUntil <= this.preNewsLockout) {
                atRisk.push({
                    currency: event.currency,
                    event: event.name,
                    timeUntil,
                    critical: this.isCriticalEvent(event.name)
                });
            }
        }

        return atRisk;
    }

    /**
     * Check if an event name matches our critical event list
     */
    isCriticalEvent(name) {
        if (!name) return false;
        const upper = name.toUpperCase();
        return this.criticalEvents.some(c => upper.includes(c.toUpperCase()));
    }

    /**
     * Get currencies affected by a symbol
     */
    getCurrenciesForSymbol(symbol) {
        if (!symbol) return [];
        
        // Try exact match
        if (this.symbolCurrencies[symbol]) return this.symbolCurrencies[symbol];

        // Try to extract from symbol name
        const currencies = [];
        const base = symbol.substring(0, 3);
        const quote = symbol.substring(3, 6);
        if (base) currencies.push(base);
        if (quote && quote !== base) currencies.push(quote);
        return currencies;
    }

    /**
     * Format milliseconds into human-readable time
     */
    formatTimeUntil(ms) {
        if (ms < 0) ms = -ms;
        const minutes = Math.floor(ms / 60000);
        if (minutes < 60) return `${minutes}min`;
        const hours = Math.floor(minutes / 60);
        const remainMin = minutes % 60;
        return `${hours}h ${remainMin}min`;
    }

    /**
     * Get status for dashboard
     */
    getStatus() {
        return {
            upcomingHighImpact: this.upcomingEvents.filter(e => 
                e.importance === 'HIGH' || e.importance === 3
            ).length,
            totalUpcoming: this.upcomingEvents.length,
            recentEvents: this.recentEvents.length,
            events: this.upcomingEvents.slice(0, 10).map(e => ({
                name: e.name,
                currency: e.currency,
                importance: e.importance,
                timeUntil: this.formatTimeUntil((e.time * 1000) - Date.now())
            }))
        };
    }
}

module.exports = new NewsFilter();
