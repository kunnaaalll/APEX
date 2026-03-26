const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

class GeminiAdapter {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.model = null;

        if (this.apiKey) {
            const genAI = new GoogleGenerativeAI(this.apiKey);
            // Use flash-lite for lower quota consumption
            this.model = genAI.getGenerativeModel({ 
                model: 'gemini-2.0-flash-lite',
                generationConfig: { responseMimeType: 'application/json' }
            });
            console.log('Gemini: Initialized with gemini-2.0-flash-lite (JSON mode)');
        }
    }

    async analyze(prompt, systemPrompt) {
        if (!this.model) return null; // Signal to use fallback

        try {
            const result = await this.model.generateContent(`${systemPrompt}\n\n${prompt}`);
            const raw = result.response.text();
            console.log('Gemini response:', raw.substring(0, 300));
            return this.parse(raw);
        } catch (error) {
            if (error.message && error.message.includes('429')) {
                console.log('Gemini: Rate limited, falling back to Ollama');
            } else {
                console.error('Gemini Error:', error.message);
            }
            return null; // Signal to use fallback
        }
    }

    parse(raw) {
        try { return this.norm(JSON.parse(raw.trim())); } catch (e) {}
        const m = raw.match(/\{[\s\S]*?"direction"[\s\S]*?\}/);
        if (m) try { return this.norm(JSON.parse(m[0])); } catch (e) {}
        const cb = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (cb) try { return this.norm(JSON.parse(cb[1].trim())); } catch (e) {}
        return null;
    }

    norm(o) {
        return {
            direction: (o.direction || 'NEUTRAL').toUpperCase(),
            confidence: parseInt(o.confidence) || 0,
            entry: parseFloat(o.entry) || 0,
            sl: parseFloat(o.sl || o.stop_loss) || 0,
            tp: parseFloat(o.tp || o.take_profit) || 0,
            rationale: o.rationale || o.reason || 'Gemini analysis'
        };
    }
}

module.exports = new GeminiAdapter();
