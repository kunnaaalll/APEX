const axios = require('axios');
require('dotenv').config();

class OllamaAdapter {
    constructor() {
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'qwen3-vl:8b';
    }

    async analyze(prompt, systemPrompt = "You are a professional financial trader.") {
        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model: this.model,
                prompt: prompt,
                system: systemPrompt,
                stream: false,
                options: { temperature: 0.3 }
            }, { timeout: 30000 });

            const raw = response.data?.response || '';
            console.log('Ollama raw (first 500 chars):', raw.substring(0, 500));

            // Try to extract JSON from the response
            return this.extractDecision(raw);
        } catch (error) {
            console.error('Ollama Error:', error.message);
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'Model unavailable' };
        }
    }

    extractDecision(raw) {
        // 1. Try direct JSON parse
        try {
            const parsed = JSON.parse(raw.trim());
            return this.normalizeDecision(parsed);
        } catch (e) {}

        // 2. Try to find JSON block in the text
        const jsonMatch = raw.match(/\{[\s\S]*?"direction"[\s\S]*?\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                return this.normalizeDecision(parsed);
            } catch (e) {}
        }

        // 3. Try to find JSON in code block
        const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
            try {
                const parsed = JSON.parse(codeBlock[1].trim());
                return this.normalizeDecision(parsed);
            } catch (e) {}
        }

        // 4. Fallback: extract key fields from text
        const direction = this.extractField(raw, /direction['":\s]*(BUY|SELL|NEUTRAL)/i);
        const confidence = this.extractNumber(raw, /confidence['":\s]*(\d+)/i);
        const entry = this.extractNumber(raw, /entry['":\s]*([\d.]+)/i);
        const sl = this.extractNumber(raw, /sl['":\s]*([\d.]+)/i) || this.extractNumber(raw, /stop.?loss['":\s]*([\d.]+)/i);
        const tp = this.extractNumber(raw, /tp['":\s]*([\d.]+)/i) || this.extractNumber(raw, /take.?profit['":\s]*([\d.]+)/i);

        // Extract rationale from text
        let rationale = '';
        const ratMatch = raw.match(/rationale['":\s]*['"](.*?)['"]/i);
        if (ratMatch) rationale = ratMatch[1];
        else {
            // Use last sentence as rationale
            const sentences = raw.split(/[.!]\s/).filter(s => s.length > 20);
            rationale = sentences.length > 0 ? sentences[sentences.length - 1].substring(0, 200) : 'AI analysis complete';
        }

        return {
            direction: direction || 'NEUTRAL',
            confidence: confidence || 0,
            entry: entry || 0,
            sl: sl || 0,
            tp: tp || 0,
            rationale: rationale
        };
    }

    normalizeDecision(obj) {
        return {
            direction: (obj.direction || 'NEUTRAL').toUpperCase(),
            confidence: parseInt(obj.confidence) || 0,
            entry: parseFloat(obj.entry) || 0,
            sl: parseFloat(obj.sl || obj.stop_loss) || 0,
            tp: parseFloat(obj.tp || obj.take_profit) || 0,
            rationale: obj.rationale || obj.reason || obj.analysis || 'AI analysis'
        };
    }

    extractField(text, regex) {
        const match = text.match(regex);
        return match ? match[1].toUpperCase() : null;
    }

    extractNumber(text, regex) {
        const match = text.match(regex);
        return match ? parseFloat(match[1]) : null;
    }
}

module.exports = new OllamaAdapter();
