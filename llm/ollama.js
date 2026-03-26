const axios = require('axios');
require('dotenv').config();

class OllamaAdapter {
    constructor() {
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'qwen3-vl:8b';
    }

    async analyze(prompt, systemPrompt = "You are a professional financial trader and market analyst.") {
        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model: this.model,
                prompt: prompt,
                system: systemPrompt,
                stream: false
            });

            console.log('Ollama raw response:', response.data.response);

            if (response.data && response.data.response) {
                try {
                    return JSON.parse(response.data.response);
                } catch (e) {
                    return response.data.response;
                }
            }
            return null;
        } catch (error) {
            console.error('Ollama Error:', error.message);
            if (error.response) {
                console.error('Data:', error.response.data);
                console.error('Status:', error.response.status);
            }
            return null;
        }
    }
}

module.exports = new OllamaAdapter();
