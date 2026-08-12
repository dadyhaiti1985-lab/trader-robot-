"""Trading strategies for the robot trader V4."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import numpy as np

from trader_robot.data import MarketData
from trader_robot.indicators import bollinger_bands, ema, macd, rsi, sma


class Signal(Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass
class TradeSignal:
    signal: Signal
    price: float
    reason: str
    strength: float = 1.0  # 0–1 confidence


class BaseStrategy(ABC):
    """Abstract base class for all trading strategies."""

    name: str = "base"

    def __init__(self, **params) -> None:
        self.params = params

    @abstractmethod
    def generate(self, data: MarketData) -> TradeSignal:
        """Return a trading signal for the latest candle."""

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.params})"


class MovingAverageCrossover(BaseStrategy):
    """Buy when fast MA crosses above slow MA; sell when it crosses below."""

    name = "ma_crossover"

    def __init__(self, fast: int = 10, slow: int = 30, ma_type: str = "ema") -> None:
        super().__init__(fast=fast, slow=slow, ma_type=ma_type)
        self.fast = fast
        self.slow = slow
        self.ma_func = ema if ma_type == "ema" else sma

    def generate(self, data: MarketData) -> TradeSignal:
        closes = data.closes
        if len(closes) < self.slow + 1:
            return TradeSignal(Signal.HOLD, closes[-1], "insufficient data")

        fast_ma = self.ma_func(closes, self.fast)
        slow_ma = self.ma_func(closes, self.slow)

        prev_fast, curr_fast = fast_ma[-2], fast_ma[-1]
        prev_slow, curr_slow = slow_ma[-2], slow_ma[-1]

        if np.isnan(prev_fast) or np.isnan(prev_slow):
            return TradeSignal(Signal.HOLD, closes[-1], "warming up")

        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return TradeSignal(Signal.BUY, closes[-1], "fast MA crossed above slow MA")
        if prev_fast >= prev_slow and curr_fast < curr_slow:
            return TradeSignal(Signal.SELL, closes[-1], "fast MA crossed below slow MA")
        return TradeSignal(Signal.HOLD, closes[-1], "no crossover")


class RSIStrategy(BaseStrategy):
    """Trade based on RSI overbought / oversold levels."""

    name = "rsi"

    def __init__(self, period: int = 14, oversold: float = 30.0, overbought: float = 70.0) -> None:
        super().__init__(period=period, oversold=oversold, overbought=overbought)
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate(self, data: MarketData) -> TradeSignal:
        closes = data.closes
        if len(closes) < self.period + 2:
            return TradeSignal(Signal.HOLD, closes[-1], "insufficient data")

        rsi_vals = rsi(closes, self.period)
        curr_rsi = rsi_vals[-1]
        prev_rsi = rsi_vals[-2]

        if np.isnan(curr_rsi) or np.isnan(prev_rsi):
            return TradeSignal(Signal.HOLD, closes[-1], "warming up")

        if prev_rsi <= self.oversold and curr_rsi > self.oversold:
            strength = min(1.0, (self.oversold - prev_rsi) / self.oversold)
            return TradeSignal(Signal.BUY, closes[-1], f"RSI crossed above {self.oversold}", strength)
        if prev_rsi >= self.overbought and curr_rsi < self.overbought:
            strength = min(1.0, (prev_rsi - self.overbought) / (100 - self.overbought))
            return TradeSignal(Signal.SELL, closes[-1], f"RSI crossed below {self.overbought}", strength)
        return TradeSignal(Signal.HOLD, closes[-1], f"RSI={curr_rsi:.1f}")


class BollingerBandStrategy(BaseStrategy):
    """Buy on lower band touch; sell on upper band touch."""

    name = "bollinger"

    def __init__(self, period: int = 20, num_std: float = 2.0) -> None:
        super().__init__(period=period, num_std=num_std)
        self.period = period
        self.num_std = num_std

    def generate(self, data: MarketData) -> TradeSignal:
        closes = data.closes
        if len(closes) < self.period:
            return TradeSignal(Signal.HOLD, closes[-1], "insufficient data")

        upper, middle, lower = bollinger_bands(closes, self.period, self.num_std)
        price = closes[-1]
        u, m, lo = upper[-1], middle[-1], lower[-1]

        if np.isnan(u):
            return TradeSignal(Signal.HOLD, price, "warming up")

        if price <= lo:
            band_width = u - lo if u > lo else 1
            strength = min(1.0, (lo - price) / (band_width * 0.1 + 1e-9))
            return TradeSignal(Signal.BUY, price, "price at lower Bollinger Band", min(1.0, strength))
        if price >= u:
            band_width = u - lo if u > lo else 1
            strength = min(1.0, (price - u) / (band_width * 0.1 + 1e-9))
            return TradeSignal(Signal.SELL, price, "price at upper Bollinger Band", min(1.0, strength))
        return TradeSignal(Signal.HOLD, price, f"price within bands ({lo:.2f}–{u:.2f})")


class MACDStrategy(BaseStrategy):
    """Trade on MACD histogram zero-crossings."""

    name = "macd"

    def __init__(self, fast: int = 12, slow: int = 26, signal_period: int = 9) -> None:
        super().__init__(fast=fast, slow=slow, signal_period=signal_period)
        self.fast = fast
        self.slow = slow
        self.signal_period = signal_period

    def generate(self, data: MarketData) -> TradeSignal:
        closes = data.closes
        if len(closes) < self.slow + self.signal_period + 1:
            return TradeSignal(Signal.HOLD, closes[-1], "insufficient data")

        _, _, hist = macd(closes, self.fast, self.slow, self.signal_period)
        curr_hist = hist[-1]
        prev_hist = hist[-2]

        if np.isnan(curr_hist) or np.isnan(prev_hist):
            return TradeSignal(Signal.HOLD, closes[-1], "warming up")

        if prev_hist < 0 and curr_hist >= 0:
            return TradeSignal(Signal.BUY, closes[-1], "MACD histogram crossed zero upward")
        if prev_hist > 0 and curr_hist <= 0:
            return TradeSignal(Signal.SELL, closes[-1], "MACD histogram crossed zero downward")
        return TradeSignal(Signal.HOLD, closes[-1], f"MACD hist={curr_hist:.4f}")


STRATEGIES: dict[str, type[BaseStrategy]] = {
    "ma_crossover": MovingAverageCrossover,
    "rsi": RSIStrategy,
    "bollinger": BollingerBandStrategy,
    "macd": MACDStrategy,
}
