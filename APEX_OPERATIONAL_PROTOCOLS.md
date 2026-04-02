# APEX ARIA v15.5 — "Operational Protocols" 🏛️🌑⚖️

This document provides a comprehensive, high-fidelity breakdown of the APEX autonomous trading architecture. It details the internal logic, timeframe synchronization, and risk protocols that govern the system's decision-making pipeline.

---

## 1. 📂 Core Architectural Flow
The APEX system operates as a closed-loop feedback system between MetaTrader 5 and the Neural Hub.

1. **SIGNAL ACQUISITION**: The `MQ5 Bridge` streams real-time price action (Tick + Candles) and MT5 Economic Calendar data.
2. **DATA SENSING**: `watcher.js` transforms raw data into high-fidelity candle arrays (M1, M5, M15, H1, H4, D1).
3. **NEURAL DETECTION**: `detector.js` runs the **SMC (Smart Money Concepts) Engine** to identify institutional order flow.
4. **CONFLUENCE SCORING**: Every setup is scored on a **0-10 Neural Matrix**. Only scores ≥ **5.5** (Aria v15.3 Overload) proceed.
5. **AI COUNCIL AUDIT**: High-confluence setups are submitted to the **Adversarial AI Council** for reasoning and confidence checks.
6. **RISK FILTRATION**: `riskGuard.js` and `newsFilter.js` apply hard institutional caps (GFT Compliance).
7. **EXECUTION**: `orderManager.js` transmits the signed strike command back to MT5 for sub-millisecond execution.

---

## 2. 🧠 Neural Detection Matrix (SMC Engine)
The system does not use retail indicators (RSI/Moving Averages) for entry. It reads **Institutional Footprints**.

### A. Structure Analysis (`concepts/smc.js`)
*   **BOS (Break of Structure)**: Confirms trend continuation by breaking previous swing highs/lows with displacement.
*   **CHoCH (Change of Character)**: The first signal of a trend reversal.
*   **Order Blocks (OB)**: Last bearish candle before a bullish impulse (or vice versa). These are institutional "Buy/Sell" zones.
*   **FVG (Fair Value Gaps)**: Price imbalances indicating aggressive smart money participation.

### B. Advanced Institutional Concepts
*   **Displacement**: Large-body candles (>2x ATR) that show institutional "intent" to move the market.
*   **OTE (Optimal Trade Entry)**: Fibonacci 0.618-0.786 retracement zones within a structural impulse leg.
*   **Liquidity Sweeps**: Identifying "Stop Hunts" where retail stop losses are harvested before the real move occurs.
*   **Inducement**: Minor structural breaks designed to trap early retail traders.

---

## 3. ⏳ Multi-Timeframe (MTF) Alignment
APEX uses a top-down institutional framework to ensure the highest probability.

| Timeframe | Function | Logic |
| :--- | :--- | :--- |
| **D1 / H4** | **Directional Bias** | Determines the "Master Trend." We ONLY trade in this direction. |
| **H1** | **Medium Confirmation** | Ensures H1 structure aligns with the HTF Bias (BOS/Trend alignment). |
| **M15 / M5** | **Execution Precision** | Finds the exact Order Block or FVG entry while in a "Discount" or "Premium" zone. |

---

## 4. ⚖️ Neural Confluence Scoring (0-10)
A trade is only considered if the cumulative score hits the **5.5 Threshold**.

*   **Structure Confirmation (BOS)**: +2.0 pts
*   **Order Block Presence**: +1.5 pts
*   **MTF Alignment (H4 agreement)**: +3.0 pts
*   **Killzone Alignment (London/NY overlap)**: +0.5 pts
*   **Displacement (Institutional Force)**: +1.0 pts
*   **Equity Curve Factor**: Multiplier based on recent win rate.

---

## 5. 🛡️ Prop Firm Guard (GFT Compliance)
Specialized protocols for **Goat Funded Trader** and other institutional accounts.

*   **Daily Loss Cap**: Hard-blocked at **4.5%** (providing a 0.5% buffer for the 5% GFT rule).
*   **Max Drawdown**: Hard-blocked at **8.0%** (protecting the 10% limit).
*   **News Profit Protection**: A **35-minute lockout** before/after high-impact news to avoid GFT's 5-minute restricted window.
*   **Position Sizing**: Institutional **1% Risk** per trade, auto-calibrated based on ATR stop-loss distance.

---

## 🗣️ Tactical Command Interface
The terminal allows you to interact with the neural core via natural language:
*   *"What is the current bias on XAUUSD?"* → Queries the D1/H4/H1 structure matrix.
*   *"Execute a buy on EURUSD"* → Triggers a `manualStrike` with full compliance-guard protection.

---
**Institutional Integrity Status: ACTIVE** 🏛️🌑⚖️
