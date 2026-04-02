const axios = require('axios');
require('dotenv').config();

class OllamaAdapter {
    constructor() {
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'qwen3:4b';
        this._available = null; // null = not checked yet
        this._checkConnection();
    }

    async _checkConnection() {
        try {
            await axios.get(`${this.baseUrl}/api/tags`, { timeout: 3000 });
            this._available = true;
        } catch (e) {
            this._available = false;
            console.log('Ollama: Not available (connection refused). Skipping local model.');
        }
    }

    get available() {
        return this._available === true;
    }

    async analyze(prompt, systemPrompt) {
        if (!this._available) {
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'Ollama not running', _error: true };
        }

        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model: this.model,
                prompt: prompt,
                system: systemPrompt,
                stream: false,
                format: 'json',
                options: { temperature: 0.3, num_predict: 256 }
            }, { timeout: 60000 });

            const raw = response.data?.response || response.data?.thinking || '';

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
            this._available = false; // Mark unavailable after connection failure
            return { direction: 'NEUTRAL', confidence: 0, rationale: 'Ollama unavailable', _error: true };
        }
    }
}

module.exports = new OllamaAdapter();
