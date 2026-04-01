/**
 * APEX Order Manager v3.0
 * 
 * Enhanced with:
 * - Smart Entry integration (limit orders at POI vs market)
 * - Dynamic position sizing (confluence + drawdown + streak aware)
 * - Correlation management (prevents currency overexposure)
 * - Spread validation (reject if spread > 20% of risk)
 * - Session-aware execution
 * - Full validation chain before execution
 */

const fs = require('fs');
const path = require('path');
const dashboard = require('../web/webDashboard');
const server = require('./server');
const riskGuard = require('./riskGuard');
const tradeManager = require('./tradeManager');
const telegram = require('../notify/telegram');
const positionSizer = require('./positionSizer');
const correlationManager = require('./correlationManager');
const smartEntry = require('./smartEntry');
const spreadFilter = require('./spreadFilter');
const regimeDetector = require('./regimeDetector');

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
        // === GATE 1: Valid SL and TP ===
        if (!setup.sl || setup.sl === 0 || !setup.tp || setup.tp === 0) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — Missing SL or TP. SL=${setup.sl || 'NONE'} TP=${setup.tp || 'NONE'}`, 'warn');
            return;
        }

        // === GATE 2: Minimum R:R of 1.5 ===
        const risk = Math.abs(setup.entry - setup.sl);
        const reward = Math.abs(setup.entry - setup.tp);
        if (reward < (1.5 * risk)) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — RR < 1:1.5. Risk=${risk.toFixed(4)} Reward=${reward.toFixed(4)}`, 'warn');
            return;
        }

        // === GATE 3: SL within 2% of entry ===
        const maxSlDistance = setup.entry * 0.02;
        if (risk > maxSlDistance) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — SL too far! Distance=${risk.toFixed(4)} Max=${maxSlDistance.toFixed(4)}`, 'warn');
            return;
        }

        // === GATE 4: SL at least 1x ATR ===
        if (setup.atr && risk < setup.atr * 1.0) {
            dashboard.logMessage(`🚫 REJECTED: ${symbol} ${setup.direction} — SL too tight! Distance=${risk.toFixed(5)} MinATR=${(setup.atr * 1.0).toFixed(5)}`, 'warn');
            return;
        }

        // === GATE 5: Risk Guard (news, daily loss, equity curve) ===
        const riskCheck = riskGuard.canTrade(symbol, setup.direction);
        if (!riskCheck.allowed) {
            dashboard.logMessage(`🛡️ RISK GUARD: ${symbol} ${setup.direction} blocked — ${riskCheck.reason}`, 'warn');
            return;
        }

        // === GATE 6: Correlation Manager ===
        const corrCheck = correlationManager.canTrade(symbol, setup.direction);
        if (!corrCheck.allowed) {
            dashboard.logMessage(`🔗 CORRELATION: ${symbol} ${setup.direction} blocked — ${corrCheck.reason}`, 'warn');
            return;
        }

        // === GATE 7: Spread validation ===
        if (setup.spread) {
            const spreadCheck = spreadFilter.canTrade(symbol, setup.spread, risk);
            if (!spreadCheck.allowed) {
                dashboard.logMessage(`📊 SPREAD: ${symbol} ${setup.direction} blocked — ${spreadCheck.reason}`, 'warn');
                return;
            }
        }

        // === SIZING: Dynamic position sizing ===
        const regime = regimeDetector.getRegime(symbol);
        const sizing = positionSizer.calculate({
            confluenceScore: setup.score || 6,
            currentDrawdown: riskCheck.adjustments?.currentDrawdown || 0,
            rollingWinRate: riskCheck.adjustments?.rollingWinRate || 50,
            consecutiveWins: riskCheck.adjustments?.consecutiveWins || 0,
            consecutiveLosses: riskCheck.adjustments?.consecutiveLosses || 0,
            regime: regime,
            accountBalance: riskCheck.adjustments?.accountBalance || 10000,
            slDistance: risk,
            symbol: symbol
        });

        if (sizing.paused) {
            dashboard.logMessage(`⏸️ PAUSED: ${symbol} — Position sizer says NO (${sizing.reasoning.join(', ')})`, 'warn');
            return;
        }

        // === SMART ENTRY: Determine limit vs market ===
        const entryResult = smartEntry.calculateEntry(symbol, setup, setup.zones || {});

        dashboard.logMessage(
            `✅ EXECUTING: ${symbol} ${setup.direction} ${entryResult.entryType} @ ${entryResult.entryPrice} ` +
            `SL=${entryResult.adjustedSL} TP=${entryResult.adjustedTP} ` +
            `RR=1:${(Math.abs(entryResult.entryPrice - entryResult.adjustedTP) / Math.abs(entryResult.entryPrice - entryResult.adjustedSL)).toFixed(1)} ` +
            `Risk: ${sizing.riskPercent}% ($${sizing.riskAmount}) | Lots: ${sizing.lotSize} | ` +
            `Entry: ${entryResult.reasoning}`,
            'info'
        );

        if (entryResult.entryType === 'MARKET') {
            // Market order
            const command = {
                symbol: symbol,
                type: 'MARKET',
                direction: setup.direction,
                volume: sizing.lotSize,
                sl: entryResult.adjustedSL,
                tp: entryResult.adjustedTP,
                riskMultiplier: 1.0
            };

            server.pendingOrders.push(command);
        } else {
            // Limit order via Smart Entry
            smartEntry.placeLimitOrder(symbol, {
                ...entryResult,
                adjustedTP: entryResult.adjustedTP,
                volume: sizing.lotSize
            });
        }

        // Save to journal JSON
        this.recordTrade({ ...setup, symbol, lotSize: sizing.lotSize, riskPercent: sizing.riskPercent, entryType: entryResult.entryType });

        // Send Telegram notification
        telegram.notifySetup(symbol, { ...setup, lotSize: sizing.lotSize, riskPercent: sizing.riskPercent }).catch(() => {});
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
