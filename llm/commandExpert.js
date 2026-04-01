/**
 * APEX Command Expert v1.0 — Natural Language Trading Interface
 * 
 * Powered by Groq 70B (or equivalent) to translate user chat into MT5 commands.
 * Capabilities:
 * - EXECUTE (Buy/Sell with auto-SL/TP)
 * - CLOSE (Specific ticket or all)
 * - HALT (Stop symbol or system)
 * - ANALYZE (On-demand market review)
 * - INTERFERE (Adjust SL/TP of active trades)
 */

const aiRouter = require('./aiRouter');
const dashboard = require('../web/webDashboard');
const server = require('../core/server');
const mlLoop = require('../core/ml_loop');

class CommandExpert {
    constructor() {
        this.persona = `You are APEX Sovereign — a disciplined, high-stakes Senior Desk Trader.
You execute user commands with military precision.
If a command is ambiguous, ask for clarification.
If a command is HIGH RISK, warn the user but still prepare it for confirmation.
You have the power to send commands directly to the MT5 Bridge.`;
    }

    async processMessage(message, marketContext = {}) {
        dashboard.logMessage(`🗣️ User: ${message}`);

        const prompt = `
USER COMMAND: "${message}"

CURRENT MARKET CONTEXT:
${JSON.stringify(marketContext, null, 2)}

TASK:
1. Determine if the user wants to EXECUTE A TRADE, CLOSE A POSITION, HALT TRADING, or ANALYZE THE MARKET.
2. If it's a trade, calculate the necessary JSON command for the MT5 Bridge.
3. ALWAYS ask for confirmation if it involves money (BUY/SELL/CLOSE).

FORMAT YOUR RESPONSE AS JSON:
{
  "response": "Your verbal response to the user",
  "requires_confirmation": true/false,
  "action": "EXECUTE|CLOSE|HALT|ANALYZE|NONE",
  "command": {
    "symbol": "EURUSD",
    "type": "BUY/SELL",
    "volume": 0.1,
    "sl": 0,
    "tp": 0,
    "ticket": 12345 (for close)
  }
}

Respond ONLY with the JSON. Be professional and brief.`;

        try {
            const result = await aiRouter.analyze(prompt, this.persona, { priority: 'high', maxTokens: 500 });
            
            // If the user said "yes" or similar to a previous confirmation, or if it's an analysis
            if (result.action === 'ANALYZE') {
                dashboard.broadcast('chat_response', { message: result.response, type: 'ai' });
            } else {
                // For now, we broadcast the response and wait for frontend interaction
                dashboard.broadcast('chat_response', { 
                    message: result.response, 
                    type: 'ai', 
                    action: result.action,
                    command: result.command,
                    requires_confirmation: result.requires_confirmation
                });
            }

            return result || { status: 'error', response: "AI generation empty signal pulse." };
        } catch (e) {
            console.error('Command Expert Error:', e.message);
            const errorMsg = `Command link disruption: ${e.message}`;
            dashboard.broadcast('chat_response', { message: errorMsg, type: 'error' });
            return { status: 'error', reason: e.message };
        }
    }

    async executeConfirmedCommand(command) {
        dashboard.logMessage(`⚔️ Sovereign: Executing confirmed command...`);
        server.addOrder(command);
        dashboard.broadcast('chat_response', { message: "Executing command on MT5 Terminal. Sovereign engagement confirmed.", type: 'success' });
    }
}

module.exports = new CommandExpert();
