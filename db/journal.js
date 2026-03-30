/**
 * APEX Journal v2.0 — Enhanced Trade Database
 * 
 * Stores trades, lessons, performance snapshots, and trade intelligence.
 * Extended schema with session tracking, MFE/MAE, exit reasons, and more.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Journal {
    constructor() {
        const dbDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const dbPath = path.join(dbDir, 'apex.db');
        this.db = new sqlite3.Database(dbPath);
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // Enhanced trades table
            this.db.run(`CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT,
                direction TEXT,
                entry_price REAL,
                sl REAL,
                tp REAL,
                status TEXT,
                outcome TEXT,
                pnl REAL,
                session TEXT,
                confluences TEXT,
                mfe REAL DEFAULT 0,
                mae REAL DEFAULT 0,
                duration_minutes INTEGER DEFAULT 0,
                partial_tp_hit INTEGER DEFAULT 0,
                breakeven_moved INTEGER DEFAULT 0,
                trailing_activated INTEGER DEFAULT 0,
                exit_reason TEXT DEFAULT 'AUTO',
                atr_at_entry REAL DEFAULT 0,
                confidence INTEGER DEFAULT 0,
                rr_planned REAL DEFAULT 0,
                rr_actual REAL DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Lessons table
            this.db.run(`CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER,
                lesson_text TEXT,
                category TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(trade_id) REFERENCES trades(id)
            )`);

            // Performance snapshots
            this.db.run(`CREATE TABLE IF NOT EXISTS performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_count INTEGER,
                win_rate REAL,
                profit_factor REAL,
                avg_rr REAL,
                max_drawdown REAL,
                total_pnl REAL,
                sharpe_ratio REAL DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Try to add new columns to existing trades table (ignore if already exist)
            const newColumns = [
                'session TEXT', 'confluences TEXT', 'mfe REAL DEFAULT 0',
                'mae REAL DEFAULT 0', 'duration_minutes INTEGER DEFAULT 0',
                'partial_tp_hit INTEGER DEFAULT 0', 'breakeven_moved INTEGER DEFAULT 0',
                'trailing_activated INTEGER DEFAULT 0', 'exit_reason TEXT DEFAULT "AUTO"',
                'atr_at_entry REAL DEFAULT 0', 'confidence INTEGER DEFAULT 0',
                'rr_planned REAL DEFAULT 0', 'rr_actual REAL DEFAULT 0'
            ];

            for (const col of newColumns) {
                const colName = col.split(' ')[0];
                this.db.run(`ALTER TABLE trades ADD COLUMN ${col}`, (err) => {
                    // Silently ignore "duplicate column" errors — column already exists
                });
            }

            // Also ensure the new category column exists on lessons for older DB files
            this.db.run(`ALTER TABLE lessons ADD COLUMN category TEXT`, (err) => {});
        });
    }

    async logTrade(trade) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(
                `INSERT INTO trades (symbol, direction, entry_price, sl, tp, status, session, atr_at_entry, confidence, rr_planned, confluences) 
                 VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`
            );
            stmt.run(
                trade.symbol,
                trade.direction,
                trade.entry,
                trade.sl,
                trade.tp,
                trade.session || '',
                trade.atr || 0,
                trade.confidence || 0,
                trade.rr || 0,
                JSON.stringify(trade.confluences || {}),
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
            stmt.finalize();
        });
    }

    async getOpenTrades() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM trades WHERE status = 'OPEN'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    async closeTrade(id, outcome, pnl, exitReason, managementData = {}) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(
                `UPDATE trades SET 
                    status = 'CLOSED', 
                    outcome = ?, 
                    pnl = ?, 
                    exit_reason = ?,
                    mfe = ?,
                    mae = ?,
                    duration_minutes = ?,
                    partial_tp_hit = ?,
                    breakeven_moved = ?,
                    trailing_activated = ?,
                    rr_actual = ?
                WHERE id = ?`
            );
            stmt.run(
                outcome,
                pnl,
                exitReason || 'AUTO',
                managementData.mfe || 0,
                managementData.mae || 0,
                managementData.duration || 0,
                managementData.partialTP ? 1 : 0,
                managementData.breakeven ? 1 : 0,
                managementData.trailing ? 1 : 0,
                managementData.rrActual || 0,
                id,
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
            stmt.finalize();
        });
    }

    async storeLesson(tradeId, lessonText, category = 'GENERAL') {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare("INSERT INTO lessons (trade_id, lesson_text, category) VALUES (?, ?, ?)");
            stmt.run(tradeId, lessonText, category, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
            stmt.finalize();
        });
    }

    async getRecentLessons(limit = 20) {
        return new Promise((resolve, reject) => {
            this.db.all(
                "SELECT lesson_text FROM lessons ORDER BY timestamp DESC LIMIT ?",
                [limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []).map(r => r.lesson_text));
                }
            );
        });
    }

    async getLessonsBySymbol(symbol, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT l.lesson_text FROM lessons l 
                 JOIN trades t ON l.trade_id = t.id 
                 WHERE t.symbol = ? 
                 ORDER BY l.timestamp DESC LIMIT ?`,
                [symbol, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []).map(r => r.lesson_text));
                }
            );
        });
    }

    async getTradeStats() {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
                    SUM(pnl) as totalPnL,
                    AVG(CASE WHEN outcome = 'WIN' THEN pnl ELSE NULL END) as avgWin,
                    AVG(CASE WHEN outcome = 'LOSS' THEN pnl ELSE NULL END) as avgLoss
                FROM trades WHERE status = 'CLOSED'`,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || {});
                }
            );
        });
    }

    async savePerformanceSnapshot(stats) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(
                `INSERT INTO performance (trade_count, win_rate, profit_factor, avg_rr, max_drawdown, total_pnl) 
                 VALUES (?, ?, ?, ?, ?, ?)`
            );
            stmt.run(
                stats.totalTrades,
                stats.winRate,
                stats.profitFactor,
                stats.avgRR,
                stats.maxDrawdown,
                stats.totalPnL,
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
            stmt.finalize();
        });
    }
}

module.exports = new Journal();
