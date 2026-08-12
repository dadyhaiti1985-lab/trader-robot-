"""Technical indicators used by trading strategies."""
from __future__ import annotations

import numpy as np


def sma(values: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average."""
    result = np.full_like(values, np.nan, dtype=float)
    for i in range(period - 1, len(values)):
        result[i] = values[i - period + 1 : i + 1].mean()
    return result


def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average."""
    result = np.full(len(values), np.nan)
    k = 2.0 / (period + 1)
    # Seed with simple average of first `period` values
    first_valid = period - 1
    if first_valid >= len(values):
        return result
    result[first_valid] = float(np.mean(values[:period]))
    for i in range(first_valid + 1, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result


def rsi(values: np.ndarray, period: int = 14) -> np.ndarray:
    """Relative Strength Index (0–100)."""
    result = np.full(len(values), np.nan)
    if len(values) < period + 1:
        return result
    deltas = np.diff(values)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = float(np.mean(gains[:period]))
    avg_loss = float(np.mean(losses[:period]))

    for i in range(period, len(values)):
        idx = i - period  # index into gains/losses (length n-1)
        avg_gain = (avg_gain * (period - 1) + gains[idx]) / period
        avg_loss = (avg_loss * (period - 1) + losses[idx]) / period
        if avg_loss == 0:
            result[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[i] = 100.0 - 100.0 / (1 + rs)
    return result


def bollinger_bands(
    values: np.ndarray, period: int = 20, num_std: float = 2.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Bollinger Bands: (upper, middle, lower)."""
    middle = sma(values, period)
    upper = np.full_like(values, np.nan, dtype=float)
    lower = np.full_like(values, np.nan, dtype=float)
    for i in range(period - 1, len(values)):
        std = float(np.std(values[i - period + 1 : i + 1], ddof=0))
        upper[i] = middle[i] + num_std * std
        lower[i] = middle[i] - num_std * std
    return upper, middle, lower


def macd(
    values: np.ndarray,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """MACD: (macd_line, signal_line, histogram)."""
    fast_ema = ema(values, fast)
    slow_ema = ema(values, slow)
    macd_line = fast_ema - slow_ema
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Average True Range."""
    n = len(closes)
    result = np.full(n, np.nan)
    tr = np.full(n, np.nan)
    for i in range(1, n):
        tr[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
    if n > period:
        result[period] = float(np.mean(tr[1 : period + 1]))
        for i in range(period + 1, n):
            result[i] = (result[i - 1] * (period - 1) + tr[i]) / period
    return result
