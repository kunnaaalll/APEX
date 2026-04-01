# APEX v3.0 — Elite Trader Enhancement Plan (Revised)

> **Scope**: All enhancements use **free APIs only**. Prop Firm Compliance deferred until 70% accuracy achieved.

---

## Free API Strategy — The Backbone

Before any enhancements, we need a **bulletproof free AI infrastructure** that runs 24/7 without interruption. Here's what's available:

| Provider | Free Limits | Best Model | Speed | JSON Support |
|---|---|---|---|---|
| **Groq** | 14,400 RPD (8B), 1,000 RPD (70B), 30 RPM | `llama-3.3-70b-versatile` | ⚡ Fastest | ✅ |
| **OpenRouter** | 50 RPD (free user) or 1,000 RPD ($10+ credits) | `deepseek/deepseek-chat:free` | Medium | ✅ |
| **Google Gemini** | ~1,500 RPD free tier | `gemini-2.5-flash` | Fast | ✅ |
| **Local Ollama** | Unlimited (your hardware) | `qwen3:4b` | Depends on HW | ✅ |

**Strategy**: Rotate across all 4 providers with smart rate-limit tracking. Even in worst case (all cloud APIs exhausted), Ollama keeps the system alive.

**Daily Capacity Estimate** (conservative):
- Groq 70B: ~1,000 calls/day
- Groq 8B: ~14,400 calls/day (use for pre-filtering)
- OpenRouter free: ~50 calls/day
- Gemini: ~1,500 calls/day  
- **Total: ~17,000+ AI calls/day — more than enough for 24/7 operation**

---

## Proposed Changes (15 Enhancements)

### Phase 1: Critical Infrastructure (Build First)

---

#### Enhancement 1: Multi-Provider AI Failover — `llm/aiRouter.js` [NEW]

The foundation everything else depends on. Replaces the single OpenRouter dependency.

##### [NEW] [aiRouter.js](file:///Applications/My%20Mac/Development/Projects/APEX/llm/aiRouter.js)

**What it does:**
- **Smart provider rotation**: Tracks remaining quota per provider per day, routes to the provider with most capacity
- **Priority cascade**: Groq 70B → Gemini Flash → OpenRouter free → Groq 8B → Ollama → Rules-only
- **Rate limit tracking**: Counts requests per provider, resets at midnight UTC. Never exceeds limits.
- **Latency tracking**: Times every request, avoids providers with >10s average response time
- **Health monitoring**: If a provider returns 3 consecutive errors, marks it "unhealthy" for 15 minutes
- **Request categorization**: 
  - **Trade decisions** (critical): Route to best available model (70B class)
  - **Post-trade reviews** (background): Route to cheapest model (8B/Ollama)  
  - **Pre-filters** (fast): Route to fastest model (Groq 8B)
- **Daily quota dashboard**: Broadcasts remaining capacity to web dashboard
- **Zero-cost guarantee**: System NEVER makes a paid API call

##### [NEW] [groq.js](file:///Applications/My%20Mac/Development/Projects/APEX/llm/groq.js)

- Groq API adapter (same interface as openrouter.js)
- Uses existing `GROQ_API_KEY` from .env (already present!)
- Models: `llama-3.3-70b-versatile` for decisions, `llama-3.1-8b-instant` for pre-filtering

##### [MODIFY] [gemini.js](file:///Applications/My%20Mac/Development/Projects/APEX/llm/gemini.js)

- Already exists but needs update to use free tier properly
- Configure for `gemini-2.5-flash` (free tier)
- Add JSON response format support

##### [MODIFY] [council.js](file:///Applications/My%20Mac/Development/Projects/APEX/llm/council.js)

- Replace direct `openrouter.analyze()` calls with `aiRouter.analyze()` 
- Council now provider-agnostic — works with any backend

---

#### Enhancement 2: Built-In Adversarial Analysis (Free Council Upgrade)

Instead of multiple expensive model calls, we use a **single model with structured adversarial prompting** — one call that forces the AI to argue both sides.

##### [MODIFY] [council.js](file:///Applications/My%20Mac/Development/Projects/APEX/llm/council.js)

**New prompt architecture** (single call, dual perspective):
```
PHASE 1 (BULL CASE): List every reason to take this trade
PHASE 2 (BEAR CASE): List every reason NOT to take this trade  
PHASE 3 (VERDICT): Weigh both cases. Only proceed if bull case 
                    clearly outweighs bear case.

Return: {
  "direction": "BUY|SELL|NEUTRAL",
  "confidence": 0-100,
  "bull_case": "...",
  "bear_case": "...", 
  "risk_score": 1-10,    // How dangerous is this trade?
  "entry": ..., "sl": ..., "tp": ...,
  "rationale": "..."
}
```

- **Risk score gate**: If `risk_score >= 7`, auto-reject regardless of confidence
- **Confidence calibration**: Track historical confidence vs actual outcome. If model says 80% but only wins 50% at that level → discount future 80% calls
- **Pre-filter call** (fast, cheap — Groq 8B): Quick yes/no "Is this worth deep analysis?" before the full analysis call. Saves ~60% of expensive calls.
- **Cost**: Same 1 primary call per setup (+ 1 cheap pre-filter) = effectively free

---

#### Enhancement 3: News Filter via MT5 Built-In Calendar — `core/newsFilter.js` [NEW]

> [!TIP]
> **MT5 has a built-in economic calendar** (`CalendarValueHistory`). No external API needed — completely free, always available, zero rate limits!

##### [MODIFY] [APEX_Bridge.mq5](file:///Applications/My%20Mac/Development/Projects/APEX/APEX_Bridge.mq5)

- Add economic calendar data to every update payload
- Uses `CalendarValueHistory()` to get upcoming events for the next 2 hours
- Sends event name, currency, importance (LOW/MEDIUM/HIGH), and time
- Filters to only currencies being traded (USD, EUR, GBP, JPY, XAU)
- Zero external API calls — built into MT5 platform

##### [NEW] [newsFilter.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/newsFilter.js)

**What it does:**
- Receives calendar data from MT5 bridge on every tick
- **Pre-news lockout**: No new trades within 30 min of HIGH impact news for affected currencies
- **Post-news cooldown**: No entries for 15 min after HIGH news (let volatility settle)
- **NFP/FOMC/CPI special rules**: Close all positions 60 min before, no trading until 30 min after
- **Active trade protection**: Tighten SL to breakeven on profitable trades before HIGH news
- **News quality scoring**: Adds/subtracts from confluence score based on proximity to news
- **Spread spike detection**: If spread widens >3x normal → likely news, block all entries

##### [MODIFY] [riskGuard.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/riskGuard.js)

- Add `checkNewsFilter()` as a gate in `canTrade()`
- News filter is one of the first checks (before any analysis work is wasted)

---

### Phase 2: Better Analysis & Entries

---

#### Enhancement 4: Multi-Timeframe Confluence — `concepts/mtf.js` [NEW]

##### [NEW] [mtf.js](file:///Applications/My%20Mac/Development/Projects/APEX/concepts/mtf.js)

**What it does:**
- **HTF Bias** (H4/D1): Determines directional bias. Only trade in direction of HTF trend  
- **MTF Confirmation** (H1): Must have BOS on H1 in same direction as HTF
- **LTF Entry** (M5/M15): Precision entry after HTF + MTF alignment confirmed
- **MTF Confluence Score**: Adds 0-3 bonus points when multiple timeframes agree
- **Conflict filter**: H4 bullish + H1 bearish CHoCH → NEUTRAL (wait)

##### [MODIFY] [APEX_Bridge.mq5](file:///Applications/My%20Mac/Development/Projects/APEX/APEX_Bridge.mq5)

- Send candle data for 3 timeframes per update: `candles_m15` (50), `candles_h1` (24), `candles_h4` (12)
- Add `candles_d1` (5 candles) for daily bias
- Increases payload but gives massively better context

##### [MODIFY] [detector.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/detector.js)

- Run SMC analysis on each timeframe separately
- HTF bias must match trade direction or confluence capped at 5/10
- Integrate MTF score into overall confluence calculation

---

#### Enhancement 5: Advanced SMC Concepts — `concepts/smc.js` [ENHANCEMENT]

##### [MODIFY] [smc.js](file:///Applications/My%20Mac/Development/Projects/APEX/concepts/smc.js)

**New detections:**

1. **Displacement Detection**: Single large-body candle moving 2x+ ATR — institutional commitment signal
2. **Inducement Detection**: Minor structure breaks that trap retail before real move
3. **Mitigation Block**: Partially filled OB — still valid for re-entry
4. **Rejection Block**: First candle to close inside broken structure — strong reversal zone
5. **Optimal Trade Entry (OTE)**: Fibonacci 0.618-0.786 zone within most recent impulse leg
6. **Imbalance Stacking**: Multiple FVGs stacked = strong institutional interest
7. **Candle Pattern Confirmation**: Engulfing, pin bar, inside bar at POI for entry timing

---

#### Enhancement 6: Regime Detection — `core/regimeDetector.js` [NEW]

##### [NEW] [regimeDetector.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/regimeDetector.js)

**What it does:**
- **ADX calculation**: Determines trend strength (built-in, no API needed)
- **Trending** (ADX > 25, clear BOS): Trade continuations only, wider TP targets
- **Ranging** (ADX < 20, no BOS): Trade reversals at extremes, tighter TP
- **Volatile** (ATR > 2x 20-period avg): Reduce risk 50%, widen SL
- **Low-Volatility** (ATR < 0.5x avg): Skip trading (spreads eat profits)
- **Breakout detection**: Consolidation near key level → prepare for breakout
- Feeds regime context into Council prompt for smarter decisions
- Updates confluence scoring: trending boosts BOS weight, ranging boosts OB/FVG weight

---

#### Enhancement 7: Spread & Microstructure Filter — `core/spreadFilter.js` [NEW]

##### [NEW] [spreadFilter.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/spreadFilter.js)

**What it does:**
- Tracks **normal spread** per symbol (rolling 100-tick average)
- Blocks entries when spread is >2x normal (illiquid/news)
- Tracks **slippage**: Intended entry price vs actual fill price from MT5
- Adjusts SL placement to account for typical spread for each symbol
- **Spread cost analysis**: If spread cost > 20% of risk amount → reject trade (spread too expensive for the setup)
- Gold (XAUUSD) gets wider tolerances than forex pairs

---

### Phase 3: Better Trade Management

---

#### Enhancement 8: Dynamic Position Sizing — `core/positionSizer.js` [NEW]

##### [NEW] [positionSizer.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/positionSizer.js)

**What it does:**
- **Confluence-Scaled Risk**:
  - Score 6-7: 0.5% risk (marginal setup)
  - Score 7-8: 0.75% risk (good setup)
  - Score 8-9: 1.0% risk (strong setup)
  - Score 9-10: 1.25% risk (elite setup — rare)
- **Drawdown-Adjusted**: As drawdown increases, risk decreases
  - 0-5% DD: Full risk
  - 5-10% DD: 75% risk
  - 10-15% DD: 50% risk
  - 15%+: Trading paused
- **Performance-Adjusted**: Uses rolling 20-trade win rate to scale
  - WR > 60%: Full risk
  - WR 40-60%: 75% risk
  - WR < 40%: 50% risk (something is wrong, play defense)
- **Anti-overconfidence**: Cap at base risk after 5 consecutive wins

---

#### Enhancement 9: Enhanced Trade Manager — Institutional-Grade Exits

##### [MODIFY] [tradeManager.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/tradeManager.js)

**New management rules:**

1. **Scaled Partial Exits** (replace single 50% close):
   - 1R: Move SL to breakeven ✅ (exists)
   - 1.5R: Close 33%
   - 2R: Close 33%, start trailing remainder  
   - Remainder: Trail at 0.75 ATR until market takes it

2. **Time-Based Management**:
   - Not at 0.5R after 2 hours → tighten SL to -0.5R
   - Not at 1R after 4 hours → close at market

3. **Volatility-Adjusted Trailing**:
   - Low ATR (< 50% normal): Trail at 0.3 ATR (tight)
   - Normal ATR: Trail at 0.5 ATR
   - High ATR (> 150% normal): Trail at 1.0 ATR (wide)

4. **Session-Aware Exit**:
   - London close approaching + trade at 0.5R-1R → take profit
   - NY close approaching → tighten all trailing stops by 50%
   - Friday 18:00 UTC → close all positions (weekend gap protection)

5. **Opposite Signal Exit**:
   - Council generates SELL on a pair where we hold BUY → immediate close

6. **Re-Entry Logic**:
   - If stopped out of valid setup and structure still holds → allow re-entry once (with tighter SL)
   - Max 1 re-entry per setup, tracked in managedPositions

---

#### Enhancement 10: Session Intelligence

##### [MODIFY] [smc.js](file:///Applications/My%20Mac/Development/Projects/APEX/concepts/smc.js) + [detector.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/detector.js)

- **Per-symbol session scoring**: Based on historical trade data
  - If GBPUSD wins 80% in London but 30% in Asian → only trade GBPUSD in London
  - Auto-learns from accumulated trades in `trade_intelligence.json`
- **Symbol-session blacklist**: Auto-blacklist symbol+session combos with <40% WR over 10+ trades
- **Day-of-week filter**: 
  - Monday: Reduce size (market finding direction)
  - First-of-month: Avoid first 2 hours (positioning flows)
- **Optimal trading hours**: Per-symbol heatmap of profitable hours (calculated from journal data)

---

### Phase 4: Better Learning & Analytics

---

#### Enhancement 11: Journaling & Analytics Enhancement

##### [MODIFY] [journal.js](file:///Applications/My%20Mac/Development/Projects/APEX/db/journal.js)

- Add `hourly_stats` table: Win rate by hour-of-day per symbol
- Add `weekly_stats` table: Win rate by day-of-week
- Add `regime_stats` table: Win rate per market regime
- Add `entry_quality` tracking: How far from ideal OB/FVG entry was actual fill?
- Add `management_effectiveness`: Compare theoretical vs actual managed PnL

##### [MODIFY] [accuracyGate.js](file:///Applications/My%20Mac/Development/Projects/APEX/eval/accuracyGate.js)

- **Expectancy calculation**: `(Win% × Avg Win) - (Loss% × Avg Loss)` per setup type
- **Sharpe Ratio**: Rolling 50-trade Sharpe for risk-adjusted performance
- **Edge Decay Detection**: Alert if WR drops 10%+ from peak in rolling 50 window
- **Setup-type auto-blacklist**: If a pattern has <40% WR over 10+ trades → stop trading it
- **Weekly performance digest**: Auto-generated Telegram report every Sunday

---

#### Enhancement 12: Daily Planning & EOD Review — `core/dailyPlanner.js` [NEW]

##### [NEW] [dailyPlanner.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/dailyPlanner.js)

**What it does:**
- **Pre-Market Planning** (runs at session open):
  - AI analyzes D1 candle, H4 structure, key levels for each watched symbol
  - Generates a "daily plan": Which symbols to focus on, directional bias, key levels to watch
  - Sends plan to Telegram + dashboard
  - Uses Groq 8B (cheap, fast) for the planning call
  
- **End-of-Day Review** (runs at NY close):
  - Summarizes all trades taken, lessons learned, performance for the day
  - Compares actual trades vs. daily plan (did we follow our own plan?)
  - Identifies behavioral patterns (revenge trading, overtrading, etc.)
  - Sends EOD report to Telegram
  - Uses background AI call (Ollama or Groq 8B)

- **Anti-Revenge Trading**: If a loss occurs and system detects attempted re-entry on same pair within 30 min with lower confluence → BLOCK (revenge trade pattern)

---

### Phase 5: Reliability & Recovery

---

#### Enhancement 13: Self-Healing & Recovery

##### [MODIFY] [apex.js](file:///Applications/My%20Mac/Development/Projects/APEX/apex.js)

- **Heartbeat monitoring**: No MT5 data for 60s → alert, 5 min → emergency mode
- **Auto-recovery**: Reconnection logic if bridge drops
- **State persistence**: Save riskGuard + tradeManager state to disk every 5 min — survives restarts
- **Crash recovery**: On startup, check for orphaned positions and resume management
- **API failover**: All AI providers down → rules-only trading (no AI, higher confluence threshold of 8/10)
- **Process monitoring**: Catch unhandled exceptions, log them, continue running

##### [MODIFY] [server.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/server.js)

- Add `/health` endpoint for external monitoring
- Add `/api/stats` endpoint returning full system status as JSON
- Add request/response logging for debugging

---

#### Enhancement 14: Smart Entry System — Limit Orders at Institutional Levels

##### [NEW] [smartEntry.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/smartEntry.js)

**What it does:**
- For high-confluence setups: Place **limit order** at OB midpoint or FVG midpoint instead of market order
- **Expiry**: Cancel after 2 hours if not filled
- **Chase prevention**: If price runs 1R without filling → cancel (missed the move)
- **Entry improvement tracking**: How much better was limit entry vs. where market order would have filled
- **Fallback**: If no clear zone, market order with 0.3 ATR buffer

##### [MODIFY] [APEX_Bridge.mq5](file:///Applications/My%20Mac/Development/Projects/APEX/APEX_Bridge.mq5)

- Add `LIMIT_BUY`, `LIMIT_SELL` command types
- Add `CANCEL_ORDER` for pending order management
- Add pending orders to positions JSON payload

---

#### Enhancement 15: Correlation & Exposure Manager

##### [NEW] [correlationManager.js](file:///Applications/My%20Mac/Development/Projects/APEX/core/correlationManager.js)

**What it does:**
- Maintains a **live correlation matrix** between watched pairs
- Blocks trades that would create >70% correlated exposure
  - Example: Already long EURUSD → blocks long GBPUSD (high positive correlation)
  - But allows long EURUSD + short USDCHF (hedge)
- **Net USD exposure tracking**: If 2 trades are both USD-short → too much directional USD risk
- **Portfolio heat**: Total open risk across all positions must stay below 3% of account
- Upgrades the current `checkCorrelation()` in riskGuard from simple symbol matching to actual correlation awareness

---

## Additional Micro-Enhancements (woven into existing modules)

| Enhancement | Where | What |
|---|---|---|
| **ATR-normalized scoring** | detector.js | Normalize confluence scores relative to ATR so volatile and calm markets score fairly |
| **Volume confirmation** | smc.js | Use tick volume from MT5 to confirm OBs (high volume OB = stronger) |
| **Wick rejection scoring** | smc.js | Long wicks at OB/FVG = strong rejection = bonus confluence |
| **EMA 200 filter** | detector.js | Add EMA 200 as trend filter — only BUY above 200, SELL below |
| **Recent swing distance** | orderManager.js | If SL is <0.5 ATR from recent swing low/high, it's too close → widen |
| **Commission tracking** | journal.js | Track commission/swap costs, include in true P&L calculations |
| **Heatmap data** | webDashboard.js | Send per-hour performance data for dashboard heatmap visualization |

---

## Execution Priority

| Priority | Enhancement | Impact | Effort | Phase |
|---|---|---|---|---|
| 🔴 P0 | #1 AI Router (Multi-Provider) | **Critical** — keeps system alive 24/7 | Medium | 1 |
| 🔴 P0 | #2 Adversarial Council (Free) | **Critical** — better decisions, same cost | Small | 1 |
| 🔴 P0 | #3 News Filter (MT5 Calendar) | **Critical** — prevents blow-ups, FREE | Medium | 1 |
| 🟠 P1 | #4 Multi-Timeframe | **High** — massive edge improvement | Large | 2 |
| 🟠 P1 | #5 Advanced SMC | **High** — better zone detection | Medium | 2 |
| 🟠 P1 | #6 Regime Detection | **High** — adapts to market | Medium | 2 |
| 🟠 P1 | #8 Dynamic Position Sizing | **High** — optimizes risk per trade | Small | 3 |
| 🟠 P1 | #9 Enhanced Trade Manager | **High** — captures more profit | Medium | 3 |
| 🟡 P2 | #7 Spread Filter | **Medium** — prevents bad entries | Small | 2 |
| 🟡 P2 | #10 Session Intelligence | **Medium** — filters bad times | Small | 3 |
| 🟡 P2 | #11 Journaling Enhancement | **Medium** — better learning | Small | 4 |
| 🟡 P2 | #12 Daily Planning/EOD | **Medium** — structure like a pro | Medium | 4 |
| 🟢 P3 | #13 Self-Healing | **Medium** — reliability | Medium | 5 |
| 🟢 P3 | #14 Smart Entry (Limits) | **Medium** — better fills | Large | 5 |
| 🟢 P3 | #15 Correlation Manager | **Medium** — portfolio risk | Medium | 5 |

---

## File Impact Summary

| Action | File | Phase |
|---|---|---|
| **NEW** | `llm/aiRouter.js` | 1 |
| **NEW** | `llm/groq.js` | 1 |
| **NEW** | `core/newsFilter.js` | 1 |
| **NEW** | `concepts/mtf.js` | 2 |
| **NEW** | `core/regimeDetector.js` | 2 |
| **NEW** | `core/spreadFilter.js` | 2 |
| **NEW** | `core/positionSizer.js` | 3 |
| **NEW** | `core/dailyPlanner.js` | 4 |
| **NEW** | `core/smartEntry.js` | 5 |
| **NEW** | `core/correlationManager.js` | 5 |
| **MODIFY** | `llm/council.js` | 1 |
| **MODIFY** | `llm/gemini.js` | 1 |
| **MODIFY** | `core/riskGuard.js` | 1-3 |
| **MODIFY** | `core/detector.js` | 2 |
| **MODIFY** | `concepts/smc.js` | 2 |
| **MODIFY** | `core/tradeManager.js` | 3 |
| **MODIFY** | `core/orderManager.js` | 3 |
| **MODIFY** | `core/server.js` | 5 |
| **MODIFY** | `APEX_Bridge.mq5` | 1-2 |
| **MODIFY** | `apex.js` | 5 |
| **MODIFY** | `db/journal.js` | 4 |
| **MODIFY** | `eval/accuracyGate.js` | 4 |

---

## Open Questions

> [!IMPORTANT]
> 1. **Shall I start with Phase 1 (AI Router + Adversarial Council + News Filter)?** These are the highest-impact, lowest-risk changes.
> 2. **Groq API key**: You already have one in `.env`. Should I verify it's still working?
> 3. **Gemini API key**: The `.env` has `GEMINI_API_KEY=` (empty). Do you have one or should we skip Gemini for now and use Groq + OpenRouter + Ollama?
> 4. **Multi-timeframe bridge**: This requires modifying the MQ5 file to send M15/H1/H4/D1 data. Are you comfortable with that change?

## Verification Plan

### Automated Tests
- Start system, verify AI router cycles through all providers
- Simulate rate limit exhaustion on primary → verify failover to secondary
- Verify news filter correctly blocks entries near high-impact events
- Test regime detector outputs for known trending/ranging data
- End-to-end: Mock MT5 data → full pipeline → verify correct output

### Manual Verification  
- Run 24-48 hours on demo, monitor Telegram for daily planning + EOD reports
- Verify dashboard shows provider usage, news events, regime status
- Compare trade quality before/after enhancements
