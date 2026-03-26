const blessed = require('blessed');
const contrib = require('blessed-contrib');

class Dashboard {
    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'APEX - Autonomous Price Execution Agent'
        });

        this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

        // 1. Logs Panel
        this.log = this.grid.set(8, 0, 4, 12, blessed.log, {
            fg: "green",
            label: 'System Logs',
            border: { type: "line", fg: "cyan" }
        });

        // 2. Stats Panel
        this.stats = this.grid.set(0, 0, 4, 4, contrib.table, {
            keys: true,
            fg: 'white',
            selectedFg: 'white',
            selectedBg: 'blue',
            interactive: false,
            label: 'Account Statistics',
            width: '30%',
            height: '30%',
            border: { type: 'line', fg: 'cyan' },
            columnSpacing: 10,
            columnWidth: [15, 10]
        });

        // 3. Trades Panel
        this.trades = this.grid.set(0, 4, 4, 8, contrib.table, {
            label: 'Open Trades',
            fg: 'green',
            interactive: false,
            border: { type: 'line', fg: 'cyan' },
            columnSpacing: 10,
            columnWidth: [10, 10, 10, 10, 10]
        });

        // 4. Performance Chart
        this.line = this.grid.set(4, 0, 4, 12, contrib.line, {
            style: { line: "yellow", text: "green", baseline: "black" },
            xLabelPadding: 3,
            xPadding: 5,
            showLegend: true,
            wholeNumbersOnly: false,
            label: 'Profit & Loss Chart'
        });

        this.screen.key(['escape', 'q', 'C-c'], () => process.exit(0));
    }

    logMessage(msg) {
        this.log.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    updateStats(data) {
        this.stats.setData({
            headers: ['Metric', 'Value'],
            data: [
                ['Balance', `$${data.balance}`],
                ['Equity', `$${data.equity}`],
                ['Margin', `$${data.margin}`],
                ['Win Rate', `${data.winRate}%`],
                ['Trades Count', `${data.tradeCount}`]
            ]
        });
        this.screen.render();
    }

    updateTrades(trades) {
        const tableData = trades.map(t => [
            t.symbol,
            t.direction,
            t.entry_price.toFixed(4),
            t.sl.toFixed(4),
            t.tp.toFixed(4)
        ]);
        this.trades.setData({
            headers: ['Symbol', 'Side', 'Entry', 'SL', 'TP'],
            data: tableData
        });
        this.screen.render();
    }

    render() {
        this.screen.render();
    }
}

module.exports = new Dashboard();
