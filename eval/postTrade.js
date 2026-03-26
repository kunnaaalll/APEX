const journal = require('../db/journal');
const ollama = require('../llm/ollama');

class PostTradeReview {
    constructor() {}

    async performReview(tradeId, outcomeData) {
        console.log(`Reviewer: Starting review for trade ${tradeId}...`);
        
        const originalTrade = await this.getTradeFromDb(tradeId);
        if (!originalTrade) return;

        const prompt = this.generateReviewPrompt(originalTrade, outcomeData);
        const lesson = await ollama.analyze(prompt, "You are a professional trading mentor. Review this trade and write one clear, actionable lesson to improve future performance.");

        if (lesson && lesson.lesson) {
            await this.storeLesson(tradeId, lesson.lesson);
            console.log(`Reviewer: Lesson stored for trade ${tradeId}: ${lesson.lesson}`);
        }
    }

    async getTradeFromDb(id) {
        // Placeholder to fetch trade from SQLite
        return { symbol: 'EURUSD', entry: 1.0850, direction: 'BUY', sl: 1.0820, tp: 1.0900 };
    }

    generateReviewPrompt(trade, outcome) {
        return `
            Trade ID: ${trade.id}
            Symbol: ${trade.symbol}
            Direction: ${trade.direction}
            Entry/SL/TP: ${trade.entry} / ${trade.sl} / ${trade.tp}
            
            Outcome: ${outcome.status} (P&L: ${outcome.pnl})
            Exit Price: ${outcome.exitPrice}
            
            Analyze what happened. Did the price hit SL before hitting TP? Was the entry too early? Write a concise lesson.
        `;
    }

    async storeLesson(tradeId, lessonText) {
        // Store in journal.js table
    }
}

module.exports = new PostTradeReview();
