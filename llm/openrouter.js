const axios = require('axios');
require('dotenv').config();

class OpenRouterAdapter {
    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.model = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
        this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    }

    async analyze(prompt, systemPrompt) {
        if (!this.apiKey) {
            console.error('OpenRouter: API Key missing in .env');
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'OpenRouter key missing' };
        }

        try {
            const response = await axios.post(this.apiUrl, {
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': 'https://github.com/apex-trading', // Optional
                    'X-Title': 'APEX Trading Bot', // Optional
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });

            const raw = response.data?.choices?.[0]?.message?.content || '';
            console.log('OpenRouter response received');

            try {
                const parsed = JSON.parse(raw.trim());
                return {
                    direction: (parsed.direction || 'NEUTRAL').toUpperCase(),
                    confidence: parseInt(parsed.confidence) || 0,
                    entry: parseFloat(parsed.entry) || 0,
                    sl: parseFloat(parsed.sl || parsed.stop_loss) || 0,
                    tp: parseFloat(parsed.tp || parsed.take_profit) || 0,
                    rationale: parsed.rationale || parsed.reason || 'OpenRouter analysis'
                };
            } catch (e) {
                console.error('OpenRouter JSON Parse Error:', e.message, raw);
                return { direction: 'NEUTRAL', confidence: 0, rationale: 'Invalid JSON response' };
            }
        } catch (error) {
            console.error('OpenRouter Error:', error.response?.data?.error || error.message);
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'OpenRouter unavailable' };
        }
    }
}

module.exports = new OpenRouterAdapter();
