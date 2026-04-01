/**
 * APEX Active Trade Manager v3.0
 * 
 * The heart of "managing like a 20-year experienced trader"
 * 
 * v3.0 Enhanced Lifecycle:
 * 1. Move SL to breakeven at 1R profit
 * 2. First partial (33%) at 1.5R
 * 3. Second partial (33%) at 2R, start trailing
 * 4. Trail remainder at volatility-adjusted ATR distance
 * 5. Time-based exit (2h/4h stale trade handling)
 * 6. Session-aware exit (London/NY close, Friday protection)
 * 7. Structure-break exit (CHoCH against trade)
 * 8. Profit giveback protection
 * 9. Shadow Trailing (Close-only SL moves)
 * 10. Volatility Protective Stop (ATR spike awareness)
 */

const dashboard = require('../web/webDashboard');
const server = require('./server');
const journal = require('../db/journal');

class TradeManager {
    constructor() {
        this.managedPositions = {};
        
        // Management thresholds
        this.breakeven_R = 1.0;          // Move SL to breakeven at 1R
        this.firstPartial_R = 1.5;       // Take 33% profit at 1.5R
        this.secondPartial_R = 2.0;      // Take 33% profit at 2R, start trailing
        this.staleTime_halfR = 2 * 60 * 60 * 1000;  // 2 hours: tighten if < 0.5R
        this.staleTime_close = 4 * 60 * 60 * 1000;  // 4 hours: close if < 1R
        
        // Tracking
        this.lastManagementCheck = 0;
        this.managementInterval = 5000;

        // V3 - Shadow Trailing State
        this.lastCandleClose = {}; // symbol -> { time, close }
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
            firstPartialTaken: false,
            secondPartialTaken: false,
            trailingActive: false,
            staleWarned2h: false,
            staleWarned4h: false,
            profitProtected: false,
            
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

            // 2. First Partial (33% at 1.5R)
            if (!managed.firstPartialTaken && managed.currentR >= this.firstPartial_R) {
                this.takePartialProfit(managed, 0.33, '1st partial at 1.5R');
                managed.firstPartialTaken = true;
            }

            // 3. Second Partial (33% at 2R) + start trailing
            if (!managed.secondPartialTaken && managed.currentR >= this.secondPartial_R) {
                this.takePartialProfit(managed, 0.5, '2nd partial at 2R'); // 50% of REMAINING
                managed.secondPartialTaken = true;
            }

            // 4. Shadow Trailing (after 2R) — Institutional close-only protection
            if (managed.currentR >= this.secondPartial_R) {
                managed.trailingActive = true;
                this.handleTrailingShadow(managed, currentPrice);
            }

            // 5. Time-Based Management
            const tradeAge = now - managed.openTime;

            // 5a. If no 0.5R in 2 hours → tighten SL to -0.5R
            if (tradeAge > this.staleTime_halfR && managed.currentR < 0.5 && !managed.staleWarned2h) {
                managed.staleWarned2h = true;
                if (managed.currentR > 0 && !managed.breakevenMoved) {
                    this.moveToBreakeven(managed);
                } else if (managed.currentR <= 0) {
                    // Tighten SL to reduce max loss to 0.5R
                    this.tightenSL(managed, 0.5, '2h stale: Tightening SL to -0.5R');
                }
                dashboard.logMessage(`⏰ STALE (2h): ${managed.symbol} #${managed.ticket} — Only ${managed.currentR.toFixed(2)}R after 2 hours.`, 'warn');
            }

            // 5b. If no 1R in 4 hours → close at market
            if (tradeAge > this.staleTime_close && managed.currentR < 1.0 && !managed.staleWarned4h) {
                managed.staleWarned4h = true;
                this.forceClose(managed.ticket, `4h stale: Only ${managed.currentR.toFixed(2)}R after 4 hours`);
            }

            // 6. Session-Aware Exit
            this.checkSessionExit(managed);

            // 7. Profit Protection — if trade gave back 50%+ of max favorable
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
     * Take partial profit — configurable percentage
     */
    takePartialProfit(managed, fraction, label) {
        const closeVolume = parseFloat((managed.remainingVolume * fraction).toFixed(2));
        if (closeVolume < 0.01) return;

        const command = {
            symbol: managed.symbol,
            type: 'CLOSE_PARTIAL',
            ticket: managed.ticket,
            volume: closeVolume
        };

        server.pendingOrders.push(command);
        managed.remainingVolume -= closeVolume;

        dashboard.logMessage(`💰 ${label}: ${managed.symbol} #${managed.ticket} — Closed ${closeVolume} lots at ${managed.currentR.toFixed(1)}R. Remaining: ${managed.remainingVolume.toFixed(2)} lots.`, 'info');
    }

    /**
     * Volatility-Adjusted Trailing Stop
     * - Low ATR (<50% normal): Trail at 0.3 ATR (tight)
     * - Normal ATR: Trail at 0.5 ATR
     * - High ATR (>150% normal): Trail at 1.0 ATR (wide)
     */
    updateTrailingStop(managed, currentPrice) {
        // Use the ATR stored at trade entry as baseline
        const atr = managed.atr;
        let trailMultiplier = 0.5; // Default

        // TODO: When regimeDetector data is available in managed, adjust
        // For now, use ATR vs riskDistance as a rough proxy
        const atrToRisk = atr / managed.riskDistance;
        if (atrToRisk < 0.5) {
            trailMultiplier = 0.3; // Low vol: tight trail
        } else if (atrToRisk > 1.5) {
            trailMultiplier = 1.0; // High vol: wide trail
        } else {
            trailMultiplier = 0.5 + (atrToRisk - 0.5) * 0.5; // Scale linearly
        }

        const trailDistance = atr * trailMultiplier;
        let newSL;

        if (managed.direction === 'BUY') {
            newSL = currentPrice - trailDistance;
            if (newSL <= managed.currentSL) return;
        } else {
            newSL = currentPrice + trailDistance;
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
            dashboard.logMessage(`📈 TRAILING: ${managed.symbol} #${managed.ticket} — Activated at ${managed.currentR.toFixed(1)}R. Trail: ${trailMultiplier.toFixed(2)}x ATR (${trailDistance.toFixed(5)})`, 'info');
        }
    }

    /**
     * Tighten SL to reduce max loss
     */
    tightenSL(managed, maxLossR, reason) {
        let newSL;

        if (managed.direction === 'BUY') {
            newSL = managed.entry - (managed.riskDistance * maxLossR);
            if (newSL <= managed.currentSL) return; // Already tighter
        } else {
            newSL = managed.entry + (managed.riskDistance * maxLossR);
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
        dashboard.logMessage(`🛠️ SL TIGHTENED: ${managed.symbol} #${managed.ticket} — ${reason}. New SL: ${newSL.toFixed(5)}`, 'info');
    }

    /**
     * Session-Aware Exit Logic
     * - London close (16:00 UTC) with +0.5R-1R: take profit
     * - NY close (21:00 UTC): tighten trailing by 50%
     * - Friday 18:00 UTC: close all (weekend gap protection)
     */
    checkSessionExit(managed) {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcDay = now.getUTCDay(); // 0=Sun, 5=Fri

        // Friday close protection (18:00 UTC)
        if (utcDay === 5 && utcHour >= 18) {
            this.forceClose(managed.ticket, 'Friday 18:00 UTC — weekend gap protection');
            return;
        }

        // London close (16:00 UTC): take profit if +0.5R to +1R
        if (utcHour === 16 && managed.currentR >= 0.5 && managed.currentR < 1.5 && !managed.trailingActive) {
            this.forceClose(managed.ticket, `London close — taking ${managed.currentR.toFixed(1)}R profit (avoid dead hours)`);
            return;
        }

        // NY close (21:00 UTC): tighten trailing stops
        if (utcHour === 21 && managed.trailingActive && !managed.nyCloseTightened) {
            managed.nyCloseTightened = true;
            // Tighten trail by 50%
            const tighterDistance = managed.atr * 0.25;
            let newSL;

            if (managed.direction === 'BUY') {
                // Estimate current price from R
                const estPrice = managed.entry + (managed.currentR * managed.riskDistance);
                newSL = estPrice - tighterDistance;
                if (newSL <= managed.currentSL) return;
            } else {
                const estPrice = managed.entry - (managed.currentR * managed.riskDistance);
                newSL = estPrice + tighterDistance;
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
            dashboard.logMessage(`🌙 NY CLOSE: ${managed.symbol} #${managed.ticket} — Trailing tightened 50% for overnight.`, 'info');
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

    /**
     * Shadow Trailing: Update with candle close data (v3.0)
     */
    updateCandleClose(symbol, candle) {
        if (!candle) return;
        this.lastCandleClose[symbol] = {
            time: candle.time,
            close: candle.close,
            high: candle.high,
            low: candle.low
        };
    }

    /**
     * Trailing Stop with Shadowing (v3.0)
     */
    handleTrailingShadow(managed, currentPrice) {
        if (!managed.trailingActive) return;

        const symbol = managed.symbol;
        const lastCandle = this.lastCandleClose[symbol];
        if (!lastCandle) return;

        // Shadow Trailing Logic: ONLY move SL if candle closes in our direction
        // This prevents wick-based stopouts
        let newSL = 0;

        if (managed.direction === 'BUY') {
            // Move SL to the low of the last closed candle
            const potentialSL = lastCandle.low - (managed.atr * 0.1);
            if (potentialSL > managed.currentSL) {
                newSL = potentialSL;
            }
        } else {
            const potentialSL = lastCandle.high + (managed.atr * 0.1);
            if (potentialSL < managed.currentSL || managed.currentSL === 0) {
                newSL = potentialSL;
            }
        }

        if (newSL > 0 && Math.abs(newSL - managed.currentSL) > managed.atr * 0.1) {
            this.updateSL(managed, newSL, 'shadow trail');
        }
    }
}

module.exports = new TradeManager();
