/**
 * APEX Groq Adapter
 * 
 * Uses Groq's ultra-fast LPU inference for free-tier AI calls.
 * Free tier: 14,400 RPD (8B), 1,000 RPD (70B), 30 RPM
 * 
 * Models:
 * - llama-3.3-70b-versatile (primary, for trade decisions)
 * - llama-3.1-8b-instant (fast pre-filter, background tasks)
 */

const axios = require('axios');
require('dotenv').config();

class GroqAdapter {
    constructor() {
        this.apiKey = process.env.GROQ_API_KEY;
        this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        this.models = {
            primary: 'llama-3.3-70b-versatile',
            fast: 'llama-3.1-8b-instant'
        };
    }

    get available() {
        return !!this.apiKey;
    }

    async analyze(prompt, systemPrompt, options = {}) {
        if (!this.apiKey) {
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'Groq key missing' };
        }

        const model = options.fast ? this.models.fast : this.models.primary;

        try {
            const response = await axios.post(this.apiUrl, {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
                max_tokens: options.maxTokens || 500,
                stream: false
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // Groq is fast, 30s is generous
            });

            const raw = response.data?.choices?.[0]?.message?.content || '';

            try {
                const parsed = JSON.parse(raw.trim());
                return {
                    direction: (parsed.direction || 'NEUTRAL').toUpperCase(),
                    confidence: parseInt(parsed.confidence) || 0,
                    entry: parseFloat(parsed.entry) || 0,
                    sl: parseFloat(parsed.sl || parsed.stop_loss) || 0,
                    tp: parseFloat(parsed.tp || parsed.take_profit) || 0,
                    rationale: parsed.rationale || parsed.reason || 'Groq analysis',
                    bull_case: parsed.bull_case || '',
                    bear_case: parsed.bear_case || '',
                    risk_score: parseInt(parsed.risk_score) || 5
                };
            } catch (e) {
                console.error('Groq JSON Parse Error:', e.message);
                return { direction: 'NEUTRAL', confidence: 0, rationale: 'Invalid JSON from Groq' };
            }
        } catch (error) {
            const status = error.response?.status;
            const errMsg = error.response?.data?.error?.message || error.message;

            if (status === 429) {
                console.log('Groq: Rate limited');
                return { direction: 'NEUTRAL', confidence: 0, rationale: 'Groq rate limited', _rateLimited: true };
            }

            console.error('Groq Error:', errMsg);
            return { direction: 'NEUTRAL', confidence: 0, rationale: `Groq error: ${errMsg}`, _error: true };
        }
    }
}

module.exports = new GroqAdapter();
