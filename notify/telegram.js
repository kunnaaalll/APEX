const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

class TelegramNotifier {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID; // User needs to set this
        this.bot = null;

        if (this.token) {
            this.bot = new TelegramBot(this.token, { polling: false });
            console.log('Telegram: Notifier initialized.');
        } else {
            console.log('Telegram: No token provided. Notifications disabled.');
        }
    }

    async send(message) {
        if (!this.bot || !this.chatId) return;

        try {
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Telegram: Error sending message:', error.message);
        }
    }

    async notifySetup(symbol, decision) {
        const msg = `🚀 *APEX Trade Setup*\n\n` +
                    `Symbol: ${symbol}\n` +
                    `Direction: ${decision.direction || 'N/A'}\n` +
                    `Confidence: ${decision.confidence || 0}%\n` +
                    `Entry: ${decision.entry || 'Market'}\n` +
                    `SL: ${decision.sl || 'N/A'}\n` +
                    `TP: ${decision.tp || 'N/A'}\n\n` +
                    `Rationale: ${decision.rationale || 'AI signal'}`;
        await this.send(msg);
    }
}

module.exports = new TelegramNotifier();
