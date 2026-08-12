"""Backtesting engine for the trader robot V4."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np

from trader_robot.data import MarketData
from trader_robot.portfolio import OrderSide, Portfolio
from trader_robot.strategies import BaseStrategy, Signal

logger = logging.getLogger(__name__)


@dataclass
class BacktestResult:
    symbol: str
    strategy_name: str
    initial_capital: float
    final_equity: float
    total_pnl: float
    total_pnl_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    total_trades: int
    win_rate: float
    equity_curve: list[float] = field(default_factory=list)
    trade_log: list[dict] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"Strategy: {self.strategy_name} | Symbol: {self.symbol}\n"
            f"  Initial Capital : ${self.initial_capital:,.2f}\n"
            f"  Final Equity    : ${self.final_equity:,.2f}\n"
            f"  Total P&L       : ${self.total_pnl:+,.2f} ({self.total_pnl_pct:+.2f}%)\n"
            f"  Max Drawdown    : {self.max_drawdown_pct:.2f}%\n"
            f"  Sharpe Ratio    : {self.sharpe_ratio:.3f}\n"
            f"  Total Trades    : {self.total_trades}\n"
            f"  Win Rate        : {self.win_rate:.1f}%"
        )


class Backtester:
    """
    Event-driven backtester.

    For each candle, generate a signal from the strategy and immediately
    fill at the next candle's open (realistic simulation).
    """

    def __init__(
        self,
        strategy: BaseStrategy,
        initial_capital: float = 10_000.0,
        position_size_pct: float = 0.95,
        slippage_pct: float = 0.001,
        commission_pct: float = 0.001,
    ) -> None:
        self.strategy = strategy
        self.initial_capital = initial_capital
        self.position_size_pct = position_size_pct
        self.slippage_pct = slippage_pct
        self.commission_pct = commission_pct

    def run(self, data: MarketData) -> BacktestResult:
        portfolio = Portfolio(self.initial_capital)
        candles = data.candles
        equity_curve: list[float] = []
        trade_log: list[dict] = []

        for i in range(len(candles) - 1):
            # Build a view of data up to candle i
            partial = MarketData(data.symbol, data.timeframe, candles[: i + 1])
            signal = self.strategy.generate(partial)

            current_candle = candles[i]
            next_candle = candles[i + 1]
            price = next_candle.open  # fill at next candle open

            symbol = data.symbol
            pos = portfolio.positions.get(symbol)
            has_position = pos is not None and pos.is_open

            if signal.signal == Signal.BUY and not has_position:
                fill_price = price * (1 + self.slippage_pct)
                commission_per_unit = fill_price * self.commission_pct
                available = portfolio.cash * self.position_size_pct
                qty = available / (fill_price + commission_per_unit)
                if qty > 0:
                    order = portfolio.place_order(symbol, OrderSide.BUY, qty, fill_price, next_candle.timestamp)
                    portfolio.fill_order(order, fill_price, next_candle.timestamp)
                    if order.status.name == "FILLED":
                        portfolio.cash -= commission_per_unit * qty
                        trade_log.append({
                            "action": "BUY",
                            "price": fill_price,
                            "qty": qty,
                            "timestamp": next_candle.timestamp,
                            "reason": signal.reason,
                        })

            elif signal.signal == Signal.SELL and has_position:
                fill_price = price * (1 - self.slippage_pct)
                commission_per_unit = fill_price * self.commission_pct
                qty = pos.quantity
                order = portfolio.place_order(symbol, OrderSide.SELL, qty, fill_price, next_candle.timestamp)
                portfolio.fill_order(order, fill_price, next_candle.timestamp)
                if order.status.name == "FILLED":
                    portfolio.cash -= commission_per_unit * qty
                    trade_log.append({
                        "action": "SELL",
                        "price": fill_price,
                        "qty": qty,
                        "timestamp": next_candle.timestamp,
                        "reason": signal.reason,
                    })

            equity_curve.append(portfolio.equity({symbol: current_candle.close}))

        # Close any open position at last close
        last_price = candles[-1].close
        final_equity = portfolio.equity({symbol: last_price})
        equity_curve.append(final_equity)

        # Statistics
        max_drawdown_pct = _max_drawdown(equity_curve)
        # Annualisation factor: map timeframe to candles per year
        _candles_per_year = {
            "1m": 252 * 24 * 60,
            "5m": 252 * 24 * 12,
            "15m": 252 * 24 * 4,
            "30m": 252 * 24 * 2,
            "1h": 252 * 24,
            "4h": 252 * 6,
            "1d": 252,
            "1w": 52,
        }
        candles_per_year = _candles_per_year.get(data.timeframe, 252 * 24)
        sharpe = _sharpe_ratio(equity_curve, candles_per_year=candles_per_year)
        win_rate = _win_rate(trade_log)

        return BacktestResult(
            symbol=data.symbol,
            strategy_name=self.strategy.name,
            initial_capital=self.initial_capital,
            final_equity=final_equity,
            total_pnl=final_equity - self.initial_capital,
            total_pnl_pct=(final_equity - self.initial_capital) / self.initial_capital * 100,
            max_drawdown_pct=max_drawdown_pct,
            sharpe_ratio=sharpe,
            total_trades=len(trade_log),
            win_rate=win_rate,
            equity_curve=equity_curve,
            trade_log=trade_log,
        )


def _max_drawdown(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0
    arr = np.array(equity_curve, dtype=float)
    peaks = np.maximum.accumulate(arr)
    drawdowns = (peaks - arr) / np.where(peaks > 0, peaks, 1)
    return float(drawdowns.max() * 100)


def _sharpe_ratio(
    equity_curve: list[float],
    risk_free_rate: float = 0.0,
    candles_per_year: int = 252 * 24,
) -> float:
    if len(equity_curve) < 2:
        return 0.0
    arr = np.array(equity_curve, dtype=float)
    returns = np.diff(arr) / np.where(arr[:-1] > 0, arr[:-1], 1)
    if returns.std() == 0:
        return 0.0
    return float((returns.mean() - risk_free_rate) / returns.std() * np.sqrt(candles_per_year))


def _win_rate(trade_log: list[dict]) -> float:
    buys = [t for t in trade_log if t["action"] == "BUY"]
    sells = [t for t in trade_log if t["action"] == "SELL"]
    pairs = min(len(buys), len(sells))
    if pairs == 0:
        return 0.0
    wins = sum(
        1 for b, s in zip(buys[:pairs], sells[:pairs]) if s["price"] > b["price"]
    )
    return wins / pairs * 100
