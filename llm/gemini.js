/**
 * APEX Gemini Adapter (Free Tier)
 * 
 * Uses Google's Gemini API free tier.
 * Free tier: ~1,500 RPD, dynamic limits per project.
 * Model: gemini-2.0-flash (free, fast, good at JSON)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

class GeminiAdapter {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        this.client = null;

        if (this.apiKey) {
            this.client = new GoogleGenerativeAI(this.apiKey);
        }
    }

    get available() {
        return !!(this.apiKey && this.client);
    }

    async analyze(prompt, systemPrompt, options = {}) {
        if (!this.client) {
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'Gemini key missing' };
        }

        try {
            const model = this.client.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: options.maxTokens || 500,
                    responseMimeType: 'application/json'
                }
            });

            const fullPrompt = `${systemPrompt}\n\n${prompt}`;
            const result = await model.generateContent(fullPrompt);
            const raw = result.response.text();

            try {
                const parsed = JSON.parse(raw.trim());
                return {
                    direction: (parsed.direction || 'NEUTRAL').toUpperCase(),
                    confidence: parseInt(parsed.confidence) || 0,
                    entry: parseFloat(parsed.entry) || 0,
                    sl: parseFloat(parsed.sl || parsed.stop_loss) || 0,
                    tp: parseFloat(parsed.tp || parsed.take_profit) || 0,
                    rationale: parsed.rationale || parsed.reason || 'Gemini analysis',
                    bull_case: parsed.bull_case || '',
                    bear_case: parsed.bear_case || '',
                    risk_score: parseInt(parsed.risk_score) || 5
                };
            } catch (e) {
                console.error('Gemini JSON Parse Error:', e.message);
                return { direction: 'NEUTRAL', confidence: 0, rationale: 'Invalid JSON from Gemini' };
            }
        } catch (error) {
            const status = error.status || error.code;
            if (status === 429 || (error.message && error.message.includes('429'))) {
                console.log('Gemini: Rate limited');
                return { direction: 'NEUTRAL', confidence: 0, rationale: 'Gemini rate limited', _rateLimited: true };
            }

            console.error('Gemini Error:', error.message);
            return { direction: 'NEUTRAL', confidence: 0, rationale: `Gemini error: ${error.message}`, _error: true };
        }
    }
}

module.exports = new GeminiAdapter();
