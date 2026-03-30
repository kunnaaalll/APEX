/**
 * APEX Active Trade Manager
 * 
 * The heart of "managing like a 20-year experienced trader"
 * 
 * Manages every open trade through its lifecycle:
 * 1. Move SL to breakeven at 1R profit
 * 2. Partial take profit at 1.5R (close 50%)
 * 3. Trailing stop at 2R (0.5 ATR distance)
 * 4. Time-based exit (stale trades)
 * 5. Structure-break exit (market turns against trade)
 * 6. LLM-assisted management decisions for complex scenarios
 */

const dashboard = require('../web/webDashboard');
const server = require('./server');
const journal = require('../db/journal');

class TradeManager {
    constructor() {
        // Track managed positions with full context
        this.managedPositions = {};
        
        // Management thresholds
        this.breakeven_R = 1.0;      // Move SL to breakeven at 1R
        this.partialTP_R = 1.5;      // Take 50% profit at 1.5R
        this.trailingStart_R = 2.0;  // Start trailing at 2R
        this.staleTime_ms = 4 * 60 * 60 * 1000; // 4 hours
        
        // Tracking
        this.lastManagementCheck = 0;
        this.managementInterval = 5000; // Check every 5 seconds
    }

    /**
     * Register a new trade for management
     */
    registerTrade(ticket, tradeData) {
        const entry = parseFloat(tradeData.price_open || tradeData.entry || 0);
        const sl = parseFloat(tradeData.sl || 0);
        const tp = parseFloat(tradeData.tp || 0);
        const direction = tradeData.type === 0 ? 'BUY' : (tradeData.direction || 'BUY');

        if (!entry || !sl) {
            dashboard.logMessage(`TradeManager: Cannot manage ticket ${ticket} — missing entry or SL`);
            return;
        }

        const riskDistance = Math.abs(entry - sl);
        const rewardDistance = tp ? Math.abs(tp - entry) : riskDistance * 2;

        this.managedPositions[ticket] = {
            ticket,
            symbol: tradeData.symbol,
            direction: direction.toUpperCase(),
            entry,
            originalSL: sl,
            currentSL: sl,
            originalTP: tp,
            currentTP: tp,
            riskDistance,
            rewardDistance,
            rr: (rewardDistance / riskDistance).toFixed(2),
            openTime: Date.now(),
            atr: tradeData.atr || riskDistance, // Use ATR if available, else risk distance
            
            // Lifecycle flags
            breakevenMoved: false,
            partialTPTaken: false,
            trailingActive: false,
            
            // Excursion tracking
            maxFavorable: 0,
            maxAdverse: 0,
            currentProfit: 0,
            currentR: 0,

            // Volume tracking
            originalVolume: tradeData.volume || 0.1,
            remainingVolume: tradeData.volume || 0.1
        };

        dashboard.logMessage(`📊 TradeManager: Tracking ticket ${ticket} ${direction} ${tradeData.symbol} | Entry: ${entry} | SL: ${sl} | TP: ${tp} | Risk: ${riskDistance.toFixed(5)} | R:R 1:${(rewardDistance / riskDistance).toFixed(1)}`);
    }

    /**
     * Main management loop — called on every tick update
     * This is where the "20-year trader experience" lives
     */
    onTickUpdate(positions) {
        if (!positions || positions.length === 0) return;

        const now = Date.now();
        if (now - this.lastManagementCheck < this.managementInterval) return;
        this.lastManagementCheck = now;

        for (const pos of positions) {
            const ticket = pos.ticket;
            let managed = this.managedPositions[ticket];

            // Auto-register untracked positions
            if (!managed) {
                this.registerTrade(ticket, pos);
                managed = this.managedPositions[ticket];
                if (!managed) continue;
            }

            // Update current state
            const currentPrice = parseFloat(pos.profit !== undefined ? 
                (managed.direction === 'BUY' ? managed.entry + (pos.profit / (managed.originalVolume * 100000 || 1)) : managed.entry - (pos.profit / (managed.originalVolume * 100000 || 1)))
                : managed.entry);

            const profit = parseFloat(pos.profit || 0);
            managed.currentProfit = profit;
            
            // Calculate R-multiple from profit direction
            const priceMove = managed.direction === 'BUY' 
                ? (currentPrice - managed.entry) 
                : (managed.entry - currentPrice);
            managed.currentR = managed.riskDistance > 0 ? priceMove / managed.riskDistance : 0;

            // Track excursions
            managed.maxFavorable = Math.max(managed.maxFavorable, profit);
            managed.maxAdverse = Math.min(managed.maxAdverse, profit);

            // === MANAGEMENT DECISIONS ===

            // 1. Breakeven Move (at 1R profit)
            if (!managed.breakevenMoved && profit > 0 && managed.currentR >= this.breakeven_R) {
                this.moveToBreakeven(managed);
            }

            // 2. Partial Take Profit (at 1.5R)
            if (!managed.partialTPTaken && managed.currentR >= this.partialTP_R) {
                this.takePartialProfit(managed);
            }

            // 3. Trailing Stop (at 2R+)
            if (managed.currentR >= this.trailingStart_R) {
                this.updateTrailingStop(managed, currentPrice);
            }

            // 4. Stale Trade Check (4+ hours with < 0.5R)
            if (now - managed.openTime > this.staleTime_ms && managed.currentR < 0.5 && managed.currentR > -0.5) {
                this.handleStaleTrade(managed);
            }

            // 5. Profit Protection — if trade gave back 50%+ of max favorable
            if (managed.maxFavorable > 0 && profit < managed.maxFavorable * 0.5 && managed.currentR > 0.5) {
                this.protectProfit(managed, currentPrice);
            }
        }
    }

    /**
     * Move SL to breakeven + spread buffer
     */
    moveToBreakeven(managed) {
        const spreadBuffer = managed.riskDistance * 0.05; // 5% of risk as buffer
        let newSL;

        if (managed.direction === 'BUY') {
            newSL = managed.entry + spreadBuffer;
        } else {
            newSL = managed.entry - spreadBuffer;
        }

        // Only move SL in favorable direction
        if (managed.direction === 'BUY' && newSL <= managed.currentSL) return;
        if (managed.direction === 'SELL' && newSL >= managed.currentSL) return;

        const command = {
            symbol: managed.symbol,
            type: 'MODIFY_SL',
            ticket: managed.ticket,
            sl: parseFloat(newSL.toFixed(5)),
            tp: managed.currentTP
        };

        server.pendingOrders.push(command);
        managed.currentSL = newSL;
        managed.breakevenMoved = true;

        dashboard.logMessage(`🔒 BREAKEVEN: ${managed.symbol} #${managed.ticket} — SL moved to ${newSL.toFixed(5)} (entry + spread). Risk eliminated.`, 'info');
    }

    /**
     * Take partial profit — close 50% of position
     */
    takePartialProfit(managed) {
        const closeVolume = parseFloat((managed.remainingVolume * 0.5).toFixed(2));
        if (closeVolume < 0.01) return; // Can't close less than minimum lot

        const command = {
            symbol: managed.symbol,
            type: 'CLOSE_PARTIAL',
            ticket: managed.ticket,
            volume: closeVolume
        };

        server.pendingOrders.push(command);
        managed.remainingVolume -= closeVolume;
        managed.partialTPTaken = true;

        dashboard.logMessage(`💰 PARTIAL TP: ${managed.symbol} #${managed.ticket} — Closed ${closeVolume} lots at 1.5R profit. Remaining: ${managed.remainingVolume.toFixed(2)} lots.`, 'info');
    }

    /**
     * Update trailing stop — follows price at 0.5 ATR distance
     */
    updateTrailingStop(managed, currentPrice) {
        const trailDistance = managed.atr * 0.5;
        let newSL;

        if (managed.direction === 'BUY') {
            newSL = currentPrice - trailDistance;
            // Only move SL up, never down
            if (newSL <= managed.currentSL) return;
        } else {
            newSL = currentPrice + trailDistance;
            // Only move SL down, never up
            if (newSL >= managed.currentSL) return;
        }

        const command = {
            symbol: managed.symbol,
            type: 'MODIFY_SL',
            ticket: managed.ticket,
            sl: parseFloat(newSL.toFixed(5)),
            tp: managed.currentTP
        };

        server.pendingOrders.push(command);
        managed.currentSL = newSL;

        if (!managed.trailingActive) {
            managed.trailingActive = true;
            dashboard.logMessage(`📈 TRAILING: ${managed.symbol} #${managed.ticket} — Trailing stop activated at ${managed.currentR.toFixed(1)}R. Distance: ${trailDistance.toFixed(5)}`, 'info');
        }
    }

    /**
     * Handle stale trades — trade going nowhere for 4+ hours
     */
    handleStaleTrade(managed) {
        // Only flag once per trade
        if (managed.staleWarned) return;
        managed.staleWarned = true;

        dashboard.logMessage(`⏰ STALE TRADE: ${managed.symbol} #${managed.ticket} — ${Math.round((Date.now() - managed.openTime) / 60000)} min with only ${managed.currentR.toFixed(2)}R movement. Consider closing.`, 'warn');

        // If trade is slightly positive, move SL to breakeven at least
        if (managed.currentR > 0.3 && !managed.breakevenMoved) {
            this.moveToBreakeven(managed);
        }
    }

    /**
     * Protect profit — price giving back gains
     */
    protectProfit(managed, currentPrice) {
        if (managed.profitProtected) return;
        managed.profitProtected = true;

        // Tighten SL to lock in remaining profit
        const lockLevel = managed.currentR * 0.5; // Lock 50% of current R
        let newSL;

        if (managed.direction === 'BUY') {
            newSL = managed.entry + (managed.riskDistance * lockLevel);
            if (newSL <= managed.currentSL) return;
        } else {
            newSL = managed.entry - (managed.riskDistance * lockLevel);
            if (newSL >= managed.currentSL) return;
        }

        const command = {
            symbol: managed.symbol,
            type: 'MODIFY_SL',
            ticket: managed.ticket,
            sl: parseFloat(newSL.toFixed(5)),
            tp: managed.currentTP
        };

        server.pendingOrders.push(command);
        managed.currentSL = newSL;

        dashboard.logMessage(`🛡️ PROFIT PROTECTION: ${managed.symbol} #${managed.ticket} — Price giving back gains. SL tightened to ${newSL.toFixed(5)} to lock ${(lockLevel * 100).toFixed(0)}% profit.`, 'warn');
    }

    /**
     * Force close a trade (structure break, conflict, etc.)
     */
    forceClose(ticket, reason) {
        const managed = this.managedPositions[ticket];
        if (!managed) return;

        const command = {
            symbol: managed.symbol,
            type: 'CLOSE_TRADE',
            ticket: managed.ticket
        };

        server.pendingOrders.push(command);
        dashboard.logMessage(`🚨 FORCE CLOSE: ${managed.symbol} #${ticket} — Reason: ${reason}`, 'warn');
    }

    /**
     * Called when a trade is detected as closed
     */
    onTradeClosed(ticket) {
        const managed = this.managedPositions[ticket];
        if (managed) {
            const duration = Math.round((Date.now() - managed.openTime) / 60000);
            dashboard.logMessage(`📋 Trade Summary #${ticket}: Duration: ${duration}min | Max R: ${(managed.maxFavorable / (managed.riskDistance * managed.originalVolume * 100000 || 1)).toFixed(2)} | BE Moved: ${managed.breakevenMoved} | Partial TP: ${managed.partialTPTaken} | Trailing: ${managed.trailingActive}`);
            
            delete this.managedPositions[ticket];
        }
    }

    /**
     * Get managed position info for a symbol
     */
    getManagedPosition(symbol) {
        for (const ticket in this.managedPositions) {
            if (this.managedPositions[ticket].symbol === symbol) {
                return this.managedPositions[ticket];
            }
        }
        return null;
    }

    /**
     * Get all managed positions
     */
    getAllPositions() {
        return { ...this.managedPositions };
    }

    /**
     * Check if structure has broken against any managed trade
     */
    checkStructureBreaks(symbol, structure) {
        const managed = this.getManagedPosition(symbol);
        if (!managed) return;

        // ChoCH against our trade direction = close
        if (structure.choch) {
            if (managed.direction === 'BUY' && structure.lastCHoCH && structure.lastCHoCH.type === 'bearish_reversal') {
                this.forceClose(managed.ticket, `CHoCH detected: Bearish reversal while holding BUY`);
            }
            if (managed.direction === 'SELL' && structure.lastCHoCH && structure.lastCHoCH.type === 'bullish_reversal') {
                this.forceClose(managed.ticket, `CHoCH detected: Bullish reversal while holding SELL`);
            }
        }
    }
}

module.exports = new TradeManager();
