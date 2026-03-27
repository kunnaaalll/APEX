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
            // Trades table
            this.db.run(`CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT,
                direction TEXT,
                entry_price REAL,
                sl REAL,
                tp REAL,
                status TEXT, -- OPEN, CLOSED, CANCELLED
                outcome TEXT, -- WIN, LOSS, BREAKEVEN
                pnl REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Lessons table
            this.db.run(`CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER,
                lesson_text TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(trade_id) REFERENCES trades(id)
            )`);
        });
    }

    async logTrade(trade) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare("INSERT INTO trades (symbol, direction, entry_price, sl, tp, status) VALUES (?, ?, ?, ?, ?, 'OPEN')");
            stmt.run(trade.symbol, trade.direction, trade.entry, trade.sl, trade.tp, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
            stmt.finalize();
        });
    }

    async getOpenTrades() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM trades WHERE status = 'OPEN'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async storeLesson(tradeId, lessonText) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare("INSERT INTO lessons (trade_id, lesson_text) VALUES (?, ?)");
            stmt.run(tradeId, lessonText, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
            stmt.finalize();
        });
    }

    async getRecentLessons(limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT lesson_text FROM lessons ORDER BY timestamp DESC LIMIT ?", [limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.lesson_text));
            });
        });
    }
}

module.exports = new Journal();
