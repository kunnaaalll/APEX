**APEX**

Autonomous Price Execution Agent

*Technical Whitepaper · Version 1.0*

  -------------------- -----------------------------------
  **Project**          APEX --- Autonomous Price Execution
                       Agent

  **Version**          1.0.0

  **Status**           Pre-production / Design Phase

  **Date**             March 2026

  **Classification**   Confidential

  **Platform**         MetaTrader 5 (Demo → Live)

  **Cost to operate**  \$0 / month (fully free stack)
  -------------------- -----------------------------------

**1. Executive Summary**

APEX (Autonomous Price Execution Agent) is a fully autonomous,
AI-powered algorithmic trading system designed to operate on MetaTrader
5 (MT5). It continuously monitors financial markets across multiple
symbols and timeframes, identifies high-confluence trading setups using
a multi-layered analysis engine, and executes trades automatically ---
including market orders, limit orders, and stop orders --- without human
intervention.

The system is built entirely on free and open-source technologies, with
zero monthly operating cost. It uses locally-run large language models
(LLMs) via OpenRouter as its primary reasoning engine, supplemented by
free-tier cloud APIs (Groq, Gemini Flash) for news analysis and
cross-validation. All trading activity, lessons, and performance metrics
are stored in a local SQLite database.

APEX operates in two phases:

- Demo phase: The agent trades exclusively on a demo MT5 account,
  learning from every trade through a structured self-evaluation loop.

- Live phase: Manually unlocked by the operator only after the agent
  achieves a 75%+ win rate across a minimum of 100 completed trades, a
  1.5+ average risk-reward ratio, and a maximum 15% drawdown --- all
  measured over a rolling 100-trade window.

**Key highlights:**

- Zero operating cost --- fully free stack

- Multi-concept analysis: SMC, technical analysis, price action,
  Wyckoff, fundamental

- Multi-LLM council: OpenRouter (primary) + Groq + Gemini for consensus-based
  decisions

- Real-time chart watching --- reacts to every closed candle across 6
  timeframes

- Smart order placement: market, limit, stop orders based on price-zone
  relationship

- 100-trade minimum accuracy gate before live trading is permitted

- Telegram notifications --- trade alerts delivered to your phone in
  real time

**2. Problem Statement**

Manual trading is cognitively demanding, emotionally volatile, and
physically limited by human attention spans. A trader cannot watch 10
currency pairs across 6 timeframes simultaneously, 24 hours a day, 5
days a week. Critical setups are missed. Emotions override discipline.
Fatigue causes errors.

Existing algorithmic trading solutions fall into two camps:

- Rule-based Expert Advisors (EAs): Fast and deterministic, but rigid.
  They cannot reason about context, adapt to changing market regimes, or
  understand the narrative behind price action.

- Commercial AI trading systems: Expensive subscriptions
  (\$200--\$2,000/month), opaque logic, no customisation, and no
  learning capability.

APEX solves both problems. It combines the speed and consistency of an
algorithm with the contextual reasoning of a large language model --- at
zero cost.

**3. System Overview**

APEX is structured as a layered pipeline. Each layer has a single
responsibility. Data flows downward through the pipeline; lessons and
feedback flow back upward to improve future decisions.

**3.1 Pipeline Layers**

  ------------- ---------------- ----------------------------------------
  **Layer**     **Name**         **Responsibility**

  1             **Data           Live MT5 tick stream, candle builder,
                ingestion**      news scraper, economic calendar

  2             **Setup          All 5 trading concept scanners fire on
                detection**      every closed candle; confluence scorer

  3             **LLM council**  OpenRouter + Groq + Gemini reason in
                                 parallel; consensus check before
                                 proceeding

  4             **Order          Selects market/limit/stop order type
                placement**      based on price-to-zone relationship;
                                 places on MT5

  5             **Trade          Monitors open trades tick-by-tick; moves
                management**     SL to breakeven, partial TP, trailing
                                 stop

  6             **Evaluation     Post-trade LLM review writes lessons;
                loop**           lessons injected into future prompts;
                                 accuracy gate
  ------------- ---------------- ----------------------------------------

**4. Trading Concepts Engine**

APEX does not rely on a single trading methodology. It implements six
independent analysis modules, each scanning for setups from a different
theoretical perspective. A trade is only considered when multiple
modules agree --- creating genuine confluence.

**4.1 Smart Money Concepts (SMC)**

SMC is the primary structural framework. It models the market as driven
by institutional (\"smart money\") participants. APEX identifies:

- Order Blocks (OB): The last bearish candle before a bullish impulse
  (or vice versa), representing institutional accumulation zones.

- Fair Value Gaps (FVG): Three-candle imbalances where price moved too
  fast, creating zones price will likely return to fill.

- Breaker Blocks: Former order blocks that have been invalidated and now
  act as opposing supply/demand.

- Liquidity Sweeps: Price movements that engineer liquidity by taking
  out stop-loss clusters above swing highs or below swing lows.

- Market Structure: Break of Structure (BOS) confirms trend
  continuation; Change of Character (CHoCH) signals potential reversal.

- Killzones: The London Open (07:00--09:00 UTC), New York Open
  (13:00--15:00 UTC), and Asian session --- periods of elevated
  institutional activity.

- Power of 3 (AMD): Accumulation, Manipulation, Distribution --- the
  three-phase intraday cycle observed in liquid markets.

**4.2 Technical Analysis**

- Exponential Moving Averages (EMA 20/50/200): Trend direction and
  dynamic support/resistance.

- RSI (14): Overbought/oversold conditions and divergence signals.

- MACD: Momentum shifts and histogram divergence.

- Bollinger Bands: Volatility contraction preceding breakouts.

- Fibonacci Retracement (0.382, 0.5, 0.618, 0.786): Key retracement
  levels aligning with SMC zones.

- Volume Analysis: Confirmation of breakouts and reversals via volume
  spike detection.

**4.3 Price Action**

- Pin Bars / Rejection Wicks: Long wicks at key levels signalling
  rejection.

- Engulfing Candles: Full body engulfment of prior candle at structure.

- Inside Bars: Consolidation patterns preceding directional moves.

- Doji Patterns: Indecision at key levels --- valid entry signal when
  combined with structure.

- Multi-timeframe entry: Higher timeframe sets directional bias; lower
  timeframe provides precision entry.

**4.4 Wyckoff Method**

- Accumulation Phases (A--E): Sideways consolidation where smart money
  absorbs supply before mark-up.

- Distribution Phases: Consolidation where smart money offloads
  positions before mark-down.

- Spring: A shakeout below support in late accumulation --- one of the
  highest-probability entry signals.

- Upthrust (UT/UTAD): A false breakout above resistance in distribution.

- Cause and Effect: The width/depth of the trading range determines the
  extent of the subsequent move.

**4.5 Fundamental Analysis**

- News Sentiment Scoring: Each headline is scored -1.0 to +1.0 for
  market impact using the Groq LLM.

- Economic Calendar: ForexFactory XML feed provides event name,
  currency, impact level, forecast vs actual.

- Central Bank Bias: Hawkish/dovish stance extracted from news and
  mapped to currency strength.

- DXY Correlation: Dollar index strength cross-checked against USD pairs
  for directional confirmation.

- Risk-on / Risk-off: Macro environment classification affects JPY,
  Gold, and index positions.

- News Blackout Window: No new orders placed within 2 hours of a red
  (high-impact) news event.

**4.6 Confluence Scoring**

Each module outputs a signal: BULLISH, BEARISH, or NEUTRAL for the
current setup. The confluence scorer counts aligned signals. A minimum
score of 3 out of 5 modules must agree before the LLM council is called.
This prevents the system from acting on low-quality, single-concept
setups.

**5. LLM Council Architecture**

The LLM Council is APEX\'s reasoning layer. Rather than relying on a
single AI model, APEX uses three independent models with different
roles. A trade is only placed when at least two of three models agree on
direction.

**5.1 Council Members**

  ------------------ -------------- ------------ ----------------------------
  **Model**          **Provider**   **Cost**     **Role**

  **DeepSeek / Llama** OpenRouter     **Paid /      Primary analyst --- SMC
  (via OpenRouter)**                Credits**    structure, Wyckoff, trade
                                                 plan, post-trade lessons

  **Llama3.1:70b**   Groq (free     **Free       News sentiment, macro bias,
                     tier)          tier**       economic calendar
                                                 interpretation

  **Gemini 1.5       Google (free   **Free       Cross-validator ---
  Flash**            tier)          tier**       challenges the trade plan,
                                                 final approval gate
  ------------------ -------------- ------------ ----------------------------

**5.2 Consensus Logic**

The following rules govern when a trade proceeds to execution:

- 3/3 agree (BUY or SELL): Strong signal --- trade placed at full
  configured risk size.

- 2/3 agree, 1 neutral: Trade placed at 50% of configured risk size.

- 2/3 disagree (one BUY, one SELL): No trade --- conflicting signals
  logged to journal.

- Any model flags high-impact news within 2 hours: No trade --- placed
  in watchlist for post-news review.

- Gemini unavailable (quota exceeded): Proceed on Ollama + Groq
  agreement (2/2).

**5.3 Prompt Architecture**

Each LLM receives a structured prompt containing:

- Symbol, timeframe, session, and current market structure summary

- Confluence score and contributing modules

- Last 5 candles\' OHLCV data formatted as a table

- Identified zones (OB levels, FVG ranges, liquidity levels)

- Current news headlines and sentiment scores

- Upcoming economic events in the next 4 hours

- Last 10 trade lessons from the journal (self-improvement context)

The model is asked to respond with a structured JSON object: direction,
entry zone, stop loss, take profit, confidence (0--100), and a brief
written rationale.

**6. Real-Time Chart Watching**

APEX\'s watcher is a persistent, always-on process. It never polls on a
fixed schedule --- it reacts to market events.

**6.1 Tick Stream**

The MT5 Python bridge subscribes to live tick data for every watched
symbol at \~100ms intervals. Each tick updates the internal candle
builder for all six timeframes: M1, M5, M15, H1, H4, and D1.

**6.2 Candle Close Events**

When a candle closes on any timeframe, the detection engine fires for
that symbol-timeframe pair. Higher timeframes (H4, D1) carry more weight
in the confluence score --- a signal on H4 counts as 1.5x a signal on
M15.

**6.3 Multi-Symbol Parallelism**

Each symbol runs its own independent detection pipeline. APEX watches
all configured symbols simultaneously using Node.js event-driven
architecture --- no symbol blocks another.

**7. Smart Order Placement**

APEX does not blindly place market orders. It evaluates the relationship
between current price and the identified setup zone, then selects the
most appropriate order type.

  ------------------ --------------- ---------------------------------------
  **Scenario**       **Order Type**  **Logic**

  Price inside zone  **MARKET**      Immediate execution at current bid/ask.
  now                                SL placed beyond zone boundary.

  Price approaching  **LIMIT**       Pre-placed at zone midpoint. Waits for
  zone                               price. Auto-cancelled if zone
                                     invalidated.

  Breakout setup     **STOP**        Placed above/below consolidation
                                     high/low. Triggers only on confirmed
                                     breakout.

  Needs confirmation **WATCHLIST**   Flagged internally. Order placed only
                                     on next candle close confirmation.

  News / conflict /  **SKIP**        Setup logged with reason. No order
  low score                          placed. Does not count in win/loss
                                     stats.
  ------------------ --------------- ---------------------------------------

**7.1 Trade Lifecycle Management**

After order placement, APEX manages every open trade with the following
rules:

- Breakeven: Stop loss moved to entry price when trade reaches 1R
  profit.

- Partial take profit: 50% of position closed at 1.5R. Remainder runs
  with trailing stop.

- Trailing stop: Activated at 2R. Follows price at a distance of 0.5
  ATR.

- Invalidation cancel: If a pending limit/stop order\'s setup zone is
  violated by a candle close, the order is cancelled and logged.

**8. Self-Improvement Loop**

APEX does not just execute trades --- it learns from them. After every
closed trade, the system triggers an automated post-trade review.

**8.1 Post-Trade Review Process**

1.  Trade closes (SL hit, TP hit, or manual close).

2.  The system assembles a review packet: the original trade plan,
    entry/exit prices, outcome (P&L), and market conditions at the time.

3.  The packet is sent to the primary OpenRouter model with a structured
    prompt asking: what was predicted, what actually happened, what the
    model got right, what it missed, and what it will do differently
    next time.

4.  The model\'s written lesson is stored in the SQLite journal with a
    timestamp and trade reference.

5.  On the next analysis cycle, the last 10--20 lessons are injected
    into every LLM prompt as context --- making every future decision
    informed by past experience.

**8.2 Memory Architecture**

Lessons are stored as plain text entries in the journal database. They
are retrieved in reverse chronological order --- most recent lessons
carry more weight as they reflect the most current market conditions.
There is no fine-tuning or model modification --- all learning happens
through prompt context injection, making the system instantly improvable
and fully transparent.

**9. Accuracy Gate --- Demo to Live Transition**

APEX will never trade live money until it has statistically proven
itself. The accuracy gate enforces strict conditions that must all be
met simultaneously before live trading is even suggested to the
operator.

**9.1 Gate Conditions**

  --------------------------- ---------------- ---------------------------
  **Condition**               **Threshold**    **Rationale**

  Minimum completed trades    **100 trades**   Statistically significant
                                               sample. Removes lucky
                                               streaks.

  Rolling win rate (last 100) **≥ 75%**        High bar ensures the model
                                               genuinely understands
                                               market structure.

  Average risk-reward ratio   **≥ 1.5R**       Ensures profitability even
                                               with occasional losses.

  Maximum drawdown (100-trade **≤ 15%**        Proves consistent risk
  window)                                      management, not just lucky
                                               wins.

  Consecutive windows above   **3 windows**    Prevents flukes. Rolling
  threshold                                    evaluation must be
                                               sustained.
  --------------------------- ---------------- ---------------------------

**9.2 What Happens When Gate Clears**

When all five conditions are met for three consecutive evaluation
windows, APEX generates a full performance report and sends it to the
operator via Telegram. The operator manually reviews the report and, if
satisfied, changes one configuration flag from \"demo\" to \"live\".
APEX never switches to live trading automatically --- that decision
always belongs to the human.

**10. Technology Stack**

APEX is engineered entirely on free and open-source components. The
total monthly operating cost is \$0.

  ------------------- ------------------ -------------- -------------------------
  **Component**       **Technology**     **Cost**       **Purpose**

  **Runtime**         Node.js 20+        **Free**       Main agent process, event
                                                        loop, CLI

  **MT5 bridge**      Python 3.11 +      **Free**       Tick data, order
                      MetaTrader5 lib                   execution, account info

  **Primary LLM**     OpenRouter +       **Paid /       Market analysis, trade
                      DeepSeek/Llama     Credits**      planning, lessons

  **News LLM**        Groq API --- Llama **Free tier**  News sentiment, macro
                      3.1 70B                           bias

  **Validator LLM**   Gemini 1.5 Flash   **Free tier**  Trade plan
                                                        cross-validation

  **Backup LLMs**     OpenRouter /       **Free         Fallback when quotas hit
                      Together AI        credits**      

  **News source**     Reuters RSS,       **Free         Headline scraping, no API
                      FXStreet RSS       (public)**     key

  **Calendar**        ForexFactory XML   **Free         Economic events, impact
                                         (public)**     levels

  **Database**        SQLite             **Free         Trades, lessons, accuracy
                                         (built-in)**   data

  **Notifications**   Telegram Bot API   **Free         Trade alerts to phone
                                         forever**      

  **Terminal UI**     Blessed (npm)      **Free**       Live dashboard in
                                                        terminal

  **Logging**         Winston (npm)      **Free**       Structured logs to files
  ------------------- ------------------ -------------- -------------------------

**10.1 Hardware Requirements**

  --------------- ------------------ ------------------ ------------------
  **Spec**        **Minimum**        **Recommended**    **Ideal**

  **RAM**         8 GB               16 GB              32 GB

  **CPU**         Any modern         Ryzen 5 / i5+      Ryzen 7 / i7+
                  (4-core)                              

  **GPU           Not required       6 GB VRAM          8 GB+ VRAM (RTX
  (optional)**                                          3060+)

  **Storage**     20 GB free         30 GB free         50 GB free

  **OS**          Windows 10/11      Windows 10/11      Windows 10/11

  **LLM model**   Llama3.1:8b        Qwen2.5:14b        Qwen2.5:14b (GPU)
  --------------- ------------------ ------------------ ------------------

*Note: MT5 requires Windows. The Node.js agent and Ollama can run on the
same Windows machine or on a separate machine on the same local
network.*

**11. Project File Structure**

  --------------------------- ----------------------------------------------
  **File / Directory**        **Purpose**

  **apex.js**                 Entry point --- apex start / apex status /
                              apex report

  .env                        Groq API key, Gemini API key, Telegram bot
                              token, MT5 credentials

  core/watcher.js             Tick stream ingestion, candle builder,
                              always-on event loop

  core/detector.js            Fires all concept scanners on every closed
                              candle

  core/confluencer.js         Scores setups, triggers LLM council when
                              threshold met

  core/orderManager.js        Places, monitors, modifies, and cancels all
                              orders

  concepts/smc.js             SMC: OB, FVG, BOS, CHoCH, liquidity, killzones

  concepts/technicals.js      EMA, RSI, MACD, Bollinger Bands, Fibonacci

  concepts/priceAction.js     Candlestick patterns, pin bars, engulfing,
                              inside bars

  concepts/wyckoff.js         Accumulation/distribution phases, spring,
                              upthrust

  concepts/fundamental.js     News sentiment, calendar events, macro bias

  llm/council.js              Orchestrates all 3 LLMs, consensus logic,
                              output parsing

  llm/openrouter.js           OpenRouter API adapter

  llm/groq.js                 Groq API adapter (free tier)

  llm/gemini.js               Gemini Flash API adapter (free tier)

  data/newsScraper.js         Reuters + FXStreet RSS headline fetcher

  data/calendar.js            ForexFactory XML economic calendar parser

  data/bridge/mt5_bridge.py   Python bridge --- MT5 tick data, orders,
                              account info

  db/journal.js               SQLite --- all trades, lessons, accuracy
                              metrics

  eval/postTrade.js           Triggers LLM review after each trade close

  eval/accuracyGate.js        100-trade rolling accuracy gate logic

  eval/lessons.js             Stores and retrieves lessons for prompt
                              injection

  notify/telegram.js          Telegram Bot --- trade alerts, reports,
                              accuracy updates

  cli/dashboard.js            Blessed terminal dashboard --- live positions,
                              P&L, logs
  --------------------------- ----------------------------------------------

**12. Risk Management Framework**

**12.1 Per-Trade Risk**

- Default risk: 1% of account balance per trade (configurable).

- Lot size is calculated automatically from account balance, risk %, and
  stop loss distance in pips.

- Maximum 3 simultaneous open trades across all symbols.

- Correlated pairs filter: APEX will not open a second USD trade if one
  is already active.

**12.2 Session-Level Risk**

- Maximum daily loss: 3% of account balance. If hit, no new trades for
  the remainder of the session.

- News blackout: No new orders within 2 hours of a red (high-impact)
  economic event.

- Session filter: APEX can be configured to trade only during specific
  killzones (London/NY open).

**12.3 Account-Level Protection**

- In demo mode, all of the above apply exactly as they would in live ---
  this is intentional, to train the agent under real constraints.

- Maximum drawdown threshold: If the rolling 100-trade drawdown exceeds
  20%, the agent pauses and sends an alert.

- The live switch is never automatic --- it always requires a deliberate
  human decision.

**13. Notifications (Telegram)**

APEX sends real-time notifications to the operator via a Telegram bot.
Setup takes approximately 5 minutes via \@BotFather and is completely
free.

**13.1 Notification Events**

- Setup detected: Symbol, timeframe, direction, confluence score.

- LLM council called: Models consulted, individual verdicts, consensus
  outcome.

- Order placed: Type (market/limit/stop), entry, SL, TP, lot size.

- Order filled: Entry price, timestamp.

- Trade closed: Exit price, P&L, win/loss, trade number.

- Accuracy update: Current win rate, trade count, gate status.

- Gate cleared: Full performance report when accuracy threshold is
  achieved.

- Agent paused: Daily loss limit hit, drawdown warning, news blackout
  active.

**14. Development Roadmap**

  ----------- ---------------- -------------------------------------------
  **Phase**   **Name**         **Deliverables**

  **1**       **Foundation**   MT5 Python bridge, tick stream, candle
                               builder, news scraper, economic calendar,
                               SQLite journal

  **2**       **Analysis       All 5 concept modules (SMC, TA, PA,
              engine**         Wyckoff, Fundamental), confluence scorer

  **3**       **LLM council**  OpenRouter adapter, Groq adapter, Gemini
                               adapter, consensus logic, prompt
                               engineering

  **4**       **Execution**    Smart order placement, trade lifecycle
                               manager, order cancellation logic

  **5**       **Learning       Post-trade review, lesson storage, prompt
              loop**           injection, accuracy gate, Telegram alerts

  **6**       **Dashboard &    Terminal UI, live positions panel, accuracy
              CLI**            charts, log viewer, apex CLI commands

  **7**       **Demo trading** Full system running on MT5 demo. Accumulate
                               100+ trades. Monitor accuracy gate.

  **8**       **Live           Gate cleared. Operator review. Manual live
              transition**     flag set. APEX trades real money.
  ----------- ---------------- -------------------------------------------

**15. Risk Disclaimer**

APEX is an experimental autonomous trading system. Trading financial
instruments carries significant risk of loss. Past performance ---
including demo performance --- does not guarantee future results. The
accuracy gate is a statistical safeguard, not a guarantee of
profitability.

By proceeding to live trading, the operator accepts full responsibility
for all financial outcomes. APEX is provided as-is, with no warranty of
any kind. The operator should never risk capital they cannot afford to
lose.

*The developers of APEX are not licensed financial advisors. Nothing in
this document or in the APEX software constitutes financial advice.*

**APEX** --- Autonomous Price Execution Agent · v1.0.0 · 2026
