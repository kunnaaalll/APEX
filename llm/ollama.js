const axios = require('axios');
require('dotenv').config();

class OllamaAdapter {
    constructor() {
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'qwen3:4b';
    }

    get available() {
        return true; // Ollama is always considered available (local)
    }

    async analyze(prompt, systemPrompt) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model: this.model,
                prompt: prompt,
                system: systemPrompt,
                stream: false,
                format: 'json',
                options: { temperature: 0.3, num_predict: 256 }
            }, { timeout: 60000 });

            // qwen3 may put output in 'thinking' or 'response'
            const raw = response.data?.response || response.data?.thinking || '';
            console.log('Ollama response:', raw.substring(0, 300));

            try {
                const parsed = JSON.parse(raw.trim());
                return {
                    direction: (parsed.direction || 'NEUTRAL').toUpperCase(),
                    confidence: parseInt(parsed.confidence) || 0,
                    entry: parseFloat(parsed.entry) || 0,
                    sl: parseFloat(parsed.sl || parsed.stop_loss) || 0,
                    tp: parseFloat(parsed.tp || parsed.take_profit) || 0,
                    rationale: parsed.rationale || parsed.reason || 'Ollama analysis'
                };
            } catch (e) {
                return { direction: 'NEUTRAL', confidence: 0, rationale: raw.substring(0, 200) };
            }
        } catch (error) {
            console.error('Ollama Error:', error.message);
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'Ollama unavailable' };
        }
    }
}

module.exports = new OllamaAdapter();
