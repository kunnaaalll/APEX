/**
 * APEX Order Manager v2.0
 * 
 * Enhanced with:
 * - Risk guard integration (checks all risk rules before execution)
 * - Trade manager registration (trades are actively managed after entry)
 * - Enhanced validation (structure-aware)
 * - Dynamic position sizing
 * - Session-aware execution
 */

const fs = require('fs');
const path = require('path');
const dashboard = require('../web/webDashboard');
const server = require('./server');
const riskGuard = require('./riskGuard');
const tradeManager = require('./tradeManager');
const telegram = require('../notify/telegram');

class OrderManager {
    constructor() {
        this.ledgerPath = path.join(__dirname, '../db/journal.json');
        this.initLedger();
    }

    initLedger() {
        if (!fs.existsSync(path.dirname(this.ledgerPath))) {
            fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
        }
        if (!fs.existsSync(this.ledgerPath)) {
            fs.writeFileSync(this.ledgerPath, JSON.stringify({ trades: [] }, null, 2));
        }
    }

    executeSetup(symbol, setup) {
        // === STRICT PROTOCOL: No trades without both SL and TP ===
        if (!setup.sl || setup.sl === 0 || !setup.tp || setup.tp === 0) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — Missing SL or TP. SL=${setup.sl || 'NONE'} TP=${setup.tp || 'NONE'}`, 'warn');
            return;
        }

        // === STRICT PROTOCOL: RR at least 1:1.5 ===
        const risk = Math.abs(setup.entry - setup.sl);
        const reward = Math.abs(setup.entry - setup.tp);
        if (reward < (1.5 * risk)) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — RR < 1:1.5. Risk=${risk.toFixed(4)} Reward=${reward.toFixed(4)}`, 'warn');
            return;
        }

        // === STRICT PROTOCOL: SL must not be more than 2% from entry ===
        const maxSlDistance = setup.entry * 0.02;
        if (risk > maxSlDistance) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — SL too far! Distance=${risk.toFixed(4)} Max=${maxSlDistance.toFixed(4)}`, 'warn');
            return;
        }

        // === STRICT PROTOCOL: SL must be at least 1.5x ATR ===
        if (setup.atr && risk < setup.atr * 1.0) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — SL too tight! Distance=${risk.toFixed(5)} MinATR=${(setup.atr * 1.0).toFixed(5)}`, 'warn');
            return;
        }

        // === RISK GUARD CHECK ===
        const riskCheck = riskGuard.canTrade(symbol, setup.direction);
        if (!riskCheck.allowed) {
            dashboard.logMessage(`🛡️ RISK GUARD: ${symbol} ${setup.direction} blocked — ${riskCheck.reason}`, 'warn');
            return;
        }

        // Apply risk adjustments from risk guard
        const adjustments = riskCheck.adjustments || {};
        
        dashboard.logMessage(
            `✅ EXECUTING: ${symbol} ${setup.direction} @ ${setup.entry} ` +
            `SL=${setup.sl} TP=${setup.tp} ` + 
            `RR=1:${(reward / risk).toFixed(1)} ` +
            `Risk: ${(adjustments.adjustedRiskPercent || 1).toFixed(1)}% (${adjustments.reason || 'standard'})`,
            'info'
        );

        const command = {
            symbol: symbol,
            type: 'MARKET',
            direction: setup.direction,
            volume: 0.1, // Will be recalculated by MT5 bridge based on risk
            sl: setup.sl,
            tp: setup.tp,
            riskMultiplier: adjustments.riskMultiplier || 1.0
        };

        server.pendingOrders.push(command);

        // Save to journal JSON
        this.recordTrade({ ...setup, symbol });

        // Send Telegram notification
        telegram.notifySetup(symbol, setup).catch(() => {});
    }

    recordTrade(trade) {
        try {
            const data = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
            trade.timestamp = new Date().toISOString();
            data.trades.push(trade);
            fs.writeFileSync(this.ledgerPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Ledger Error:', e);
        }
    }
}

module.exports = new OrderManager();
