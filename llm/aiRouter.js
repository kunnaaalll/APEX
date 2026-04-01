/**
 * APEX AI Router — Multi-Provider Failover System
 * 
 * The brain's lifeline. Ensures 24/7 AI availability by rotating
 * across free providers with smart rate-limit tracking.
 * 
 * Provider Priority (for trade decisions):
 * 1. Groq 70B (fastest, most generous free tier)
 * 2. OpenRouter free models (deepseek-chat:free, llama-3.3-70b:free)
 * 3. Gemini Flash (Google free tier)
 * 4. Groq 8B (fast fallback)
 * 5. Local Ollama (unlimited, always available)
 * 6. Rules-only mode (no AI — pure confluence scoring)
 * 
 * Daily capacity: ~17,000+ calls/day across all providers
 */

const groq = require('./groq');
const openrouter = require('./openrouter');
const gemini = require('./gemini');
const ollama = require('./ollama');
const dashboard = require('../web/webDashboard');

class AIRouter {
    constructor() {
        // Provider definitions with rate limit tracking
        this.providers = {
            groq_70b: {
                name: 'Groq 70B',
                adapter: groq,
                options: { fast: false },
                dailyLimit: 1000,
                minuteLimit: 30,
                dailyUsed: 0,
                minuteUsed: 0,
                minuteResetAt: 0,
                healthy: true,
                unhealthyUntil: 0,
                consecutiveErrors: 0,
                avgLatency: 0,
                totalCalls: 0,
                priority: 1 // Lower = higher priority
            },
            openrouter: {
                name: 'OpenRouter Free',
                adapter: openrouter,
                options: {},
                dailyLimit: 50, // Free user; 1000 if credits added
                minuteLimit: 20,
                dailyUsed: 0,
                minuteUsed: 0,
                minuteResetAt: 0,
                healthy: true,
                unhealthyUntil: 0,
                consecutiveErrors: 0,
                avgLatency: 0,
                totalCalls: 0,
                priority: 2
            },
            gemini: {
                name: 'Gemini Flash',
                adapter: gemini,
                options: {},
                dailyLimit: 1500,
                minuteLimit: 15,
                dailyUsed: 0,
                minuteUsed: 0,
                minuteResetAt: 0,
                healthy: true,
                unhealthyUntil: 0,
                consecutiveErrors: 0,
                avgLatency: 0,
                totalCalls: 0,
                priority: 3
            },
            groq_8b: {
                name: 'Groq 8B Fast',
                adapter: groq,
                options: { fast: true },
                dailyLimit: 14400,
                minuteLimit: 30,
                dailyUsed: 0,
                minuteUsed: 0,
                minuteResetAt: 0,
                healthy: true,
                unhealthyUntil: 0,
                consecutiveErrors: 0,
                avgLatency: 0,
                totalCalls: 0,
                priority: 4
            },
            ollama: {
                name: 'Local Ollama',
                adapter: ollama,
                options: {},
                dailyLimit: Infinity,
                minuteLimit: Infinity,
                dailyUsed: 0,
                minuteUsed: 0,
                minuteResetAt: 0,
                healthy: true,
                unhealthyUntil: 0,
                consecutiveErrors: 0,
                avgLatency: 0,
                totalCalls: 0,
                priority: 5
            }
        };

        // Daily reset tracking
        this.todayDate = new Date().toUTCString().split(' ').slice(0, 4).join(' ');

        // Stats
        this.totalRequests = 0;
        this.totalFailovers = 0;

        console.log('AI Router: Initialized with providers:', 
            Object.entries(this.providers)
                .filter(([_, p]) => p.adapter.available !== false)
                .map(([k, p]) => `${p.name} (${p.dailyLimit}/day)`)
                .join(', ')
        );
    }

    /**
     * Main entry: Route an analysis request to the best available provider
     * 
     * @param {string} prompt - The analysis prompt
     * @param {string} systemPrompt - System prompt
     * @param {object} options - { priority: 'high'|'low'|'prefilter', maxTokens: number }
     * @returns {object} Analysis result
     */
    async analyze(prompt, systemPrompt, options = {}) {
        this.checkDayReset();
        this.totalRequests++;

        // Get ordered list of eligible providers
        const priority = options.priority || 'high';
        const candidates = this.getCandidates(priority);

        if (candidates.length === 0) {
            dashboard.logMessage('⚠️ AI Router: ALL providers exhausted! Using rules-only mode.', 'warn');
            return {
                direction: 'NEUTRAL',
                confidence: 0,
                rationale: 'All AI providers exhausted — rules-only mode active',
                _provider: 'none',
                _rulesOnly: true
            };
        }

        // Try each candidate in order
        for (const key of candidates) {
            const provider = this.providers[key];
            const start = Date.now();

            try {
                // Check minute-level rate limit
                this.checkMinuteReset(provider);
                if (provider.minuteUsed >= provider.minuteLimit) continue;

                // Make the call
                const result = await provider.adapter.analyze(
                    prompt,
                    systemPrompt,
                    { ...provider.options, maxTokens: options.maxTokens }
                );

                const latency = Date.now() - start;

                // Check for rate limit response
                if (result._rateLimited) {
                    provider.minuteUsed = provider.minuteLimit; // Max out minute counter
                    this.totalFailovers++;
                    dashboard.logMessage(`🔄 AI Router: ${provider.name} rate limited, trying next...`);
                    continue;
                }

                // Check for error response
                if (result._error) {
                    provider.consecutiveErrors++;
                    if (provider.consecutiveErrors >= 3) {
                        provider.healthy = false;
                        provider.unhealthyUntil = Date.now() + (15 * 60 * 1000); // 15 min cooldown
                        dashboard.logMessage(`⚠️ AI Router: ${provider.name} marked unhealthy (3 consecutive errors)`, 'warn');
                    }
                    this.totalFailovers++;
                    continue;
                }

                // SUCCESS — update stats
                provider.dailyUsed++;
                provider.minuteUsed++;
                provider.consecutiveErrors = 0;
                provider.totalCalls++;
                provider.avgLatency = provider.totalCalls === 1
                    ? latency
                    : (provider.avgLatency * 0.9 + latency * 0.1); // EMA of latency

                // Tag the result with provider info
                result._provider = provider.name;
                result._latency = latency;
                result._dailyRemaining = provider.dailyLimit - provider.dailyUsed;

                return result;

            } catch (err) {
                provider.consecutiveErrors++;
                this.totalFailovers++;
                console.error(`AI Router: ${provider.name} error:`, err.message);
                continue;
            }
        }

        // All candidates failed
        dashboard.logMessage('⚠️ AI Router: All candidates failed for this request.', 'warn');
        return {
            direction: 'NEUTRAL',
            confidence: 0,
            rationale: 'All AI providers failed',
            _provider: 'none',
            _rulesOnly: true
        };
    }

    /**
     * Get ordered list of eligible providers for a request type
     */
    getCandidates(priority) {
        const now = Date.now();

        return Object.keys(this.providers)
            .filter(key => {
                const p = this.providers[key];

                // Check availability
                if (p.adapter.available === false) return false;

                // Check health
                if (!p.healthy && now < p.unhealthyUntil) return false;
                if (!p.healthy && now >= p.unhealthyUntil) {
                    p.healthy = true; // Reset health after cooldown
                    p.consecutiveErrors = 0;
                }

                // Check daily quota
                if (p.dailyUsed >= p.dailyLimit) return false;

                return true;
            })
            .sort((a, b) => {
                const pa = this.providers[a];
                const pb = this.providers[b];

                if (priority === 'prefilter') {
                    // For pre-filters: prefer fast/cheap models
                    if (a === 'groq_8b') return -1;
                    if (b === 'groq_8b') return 1;
                    if (a === 'ollama') return -1;
                    if (b === 'ollama') return 1;
                }

                if (priority === 'low') {
                    // For background tasks: prefer cheap models, save quota for decisions
                    if (a === 'ollama') return -1;
                    if (b === 'ollama') return 1;
                    if (a === 'groq_8b') return -1;
                    if (b === 'groq_8b') return 1;
                }

                // For high priority: use configured priority order
                return pa.priority - pb.priority;
            });
    }

    /**
     * Reset daily counters at midnight UTC
     */
    checkDayReset() {
        const today = new Date().toUTCString().split(' ').slice(0, 4).join(' ');
        if (today !== this.todayDate) {
            this.todayDate = today;
            for (const key in this.providers) {
                this.providers[key].dailyUsed = 0;
            }
            dashboard.logMessage('🔄 AI Router: Daily quotas reset.');
        }
    }

    /**
     * Reset per-minute counters
     */
    checkMinuteReset(provider) {
        const now = Date.now();
        if (now >= provider.minuteResetAt) {
            provider.minuteUsed = 0;
            provider.minuteResetAt = now + 60000;
        }
    }

    /**
     * Get status for dashboard/monitoring
     */
    getStatus() {
        const status = {};
        for (const [key, p] of Object.entries(this.providers)) {
            status[key] = {
                name: p.name,
                available: p.adapter.available !== false,
                healthy: p.healthy,
                dailyUsed: p.dailyUsed,
                dailyLimit: p.dailyLimit === Infinity ? '∞' : p.dailyLimit,
                dailyRemaining: p.dailyLimit === Infinity ? '∞' : Math.max(0, p.dailyLimit - p.dailyUsed),
                avgLatency: `${Math.round(p.avgLatency)}ms`,
                totalCalls: p.totalCalls
            };
        }
        status._totalRequests = this.totalRequests;
        status._totalFailovers = this.totalFailovers;
        return status;
    }
}

module.exports = new AIRouter();
