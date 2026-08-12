# Trader Robot V4

An automated trading robot built in Python, featuring multiple technical strategies, an event-driven backtesting engine, and a paper trading simulator.

---

## Features

| Component | Description |
|---|---|
| **Strategies** | Moving Average Crossover, RSI, Bollinger Bands, MACD |
| **Indicators** | SMA, EMA, RSI, Bollinger Bands, MACD, ATR |
| **Backtester** | Event-driven, slippage & commission aware, Sharpe/drawdown metrics |
| **Paper Trader** | Real-time simulation over replayed candles |
| **Portfolio** | Full order & position tracking with P&L accounting |
| **CLI** | `backtest`, `paper-trade`, `list-strategies` commands |

---

## Installation

```bash
pip install -r requirements.txt
pip install -e .
```

---

## Quick Start

### List available strategies
```bash
trader-robot list-strategies
```

### Run a backtest
```bash
# Moving Average Crossover (default)
trader-robot backtest --strategy ma_crossover --periods 500

# RSI strategy, JSON output
trader-robot backtest --strategy rsi --periods 500 --json

# Bollinger Bands
trader-robot backtest --strategy bollinger --capital 50000

# MACD
trader-robot backtest --strategy macd --periods 300
```

### Paper trading simulation
```bash
trader-robot paper-trade --strategy ma_crossover --candles 200
```

---

## Strategies

### Moving Average Crossover (`ma_crossover`)
Buys when the fast MA crosses above the slow MA; sells on the reverse crossover.
Supports both EMA (default) and SMA.

```bash
trader-robot backtest --strategy ma_crossover --fast 10 --slow 30
```

### RSI (`rsi`)
Buys when RSI crosses back above the oversold level; sells when it crosses below overbought.

```bash
trader-robot backtest --strategy rsi --rsi-period 14 --oversold 30 --overbought 70
```

### Bollinger Bands (`bollinger`)
Buys when price touches or breaks the lower band; sells at the upper band.

### MACD (`macd`)
Trades on histogram zero-line crossings (fast=12, slow=26, signal=9).

---

## Configuration

All defaults can be overridden via environment variables or a `.env` file:

| Variable | Default | Description |
|---|---|---|
| `INITIAL_CAPITAL` | `10000` | Starting capital in USD |
| `SYMBOL` | `BTC/USDT` | Trading pair |
| `TIMEFRAME` | `1h` | Candle timeframe |
| `STRATEGY` | `ma_crossover` | Strategy name |
| `POSITION_SIZE_PCT` | `0.95` | Fraction of capital per trade |
| `SLIPPAGE_PCT` | `0.001` | Slippage (0.1%) |
| `COMMISSION_PCT` | `0.001` | Commission per fill (0.1%) |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

Copy `.env.example` to `.env` and adjust as needed.

---

## Project Structure

```
trader_robot/
├── __init__.py          # Package root
├── config.py            # Configuration dataclass
├── data/                # MarketData, Candle, synthetic data generator
│   └── __init__.py
├── indicators/          # SMA, EMA, RSI, Bollinger, MACD, ATR
│   └── __init__.py
├── strategies/          # BaseStrategy + 4 concrete strategies
│   └── __init__.py
├── portfolio.py         # Order, Position, Portfolio
├── backtest.py          # Backtester, BacktestResult
├── trader.py            # PaperTrader
└── main.py              # CLI entry point

tests/
├── test_indicators.py
├── test_strategies.py
├── test_portfolio.py
├── test_backtest.py
└── test_cli.py
```

---

## Running Tests

```bash
pip install pytest
pytest tests/ -v
```

---

## Backtest Metrics

| Metric | Description |
|---|---|
| **Total P&L** | Absolute and % profit/loss |
| **Max Drawdown** | Largest peak-to-trough equity decline |
| **Sharpe Ratio** | Risk-adjusted return (annualised) |
| **Win Rate** | % of closed trades that were profitable |
| **Total Trades** | Number of completed round-trip trades |