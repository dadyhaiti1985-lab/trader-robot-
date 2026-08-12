"""Data layer: fetch and cache market OHLCV data."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class Candle:
    """Represents a single OHLCV candle."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketData:
    """Container for OHLCV time-series data."""

    def __init__(self, symbol: str, timeframe: str, candles: list[Candle]) -> None:
        self.symbol = symbol
        self.timeframe = timeframe
        self.candles = candles
        self._df: Optional[pd.DataFrame] = None

    @classmethod
    def from_dataframe(cls, symbol: str, timeframe: str, df: pd.DataFrame) -> "MarketData":
        required = {"open", "high", "low", "close", "volume"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"DataFrame missing columns: {missing}")
        candles = [
            Candle(
                timestamp=(
                    row.name if isinstance(row.name, datetime)
                    else row.name.to_pydatetime() if hasattr(row.name, "to_pydatetime")
                    else datetime(1970, 1, 1) + __import__("datetime").timedelta(microseconds=int(row.name) // 1000)
                ),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row["volume"]),
            )
            for _, row in df.iterrows()
        ]
        return cls(symbol, timeframe, candles)

    def to_dataframe(self) -> pd.DataFrame:
        if self._df is None:
            records = [
                {
                    "timestamp": c.timestamp,
                    "open": c.open,
                    "high": c.high,
                    "low": c.low,
                    "close": c.close,
                    "volume": c.volume,
                }
                for c in self.candles
            ]
            self._df = pd.DataFrame(records).set_index("timestamp")
        return self._df

    @property
    def closes(self) -> np.ndarray:
        return self.to_dataframe()["close"].to_numpy()

    @property
    def highs(self) -> np.ndarray:
        return self.to_dataframe()["high"].to_numpy()

    @property
    def lows(self) -> np.ndarray:
        return self.to_dataframe()["low"].to_numpy()

    @property
    def volumes(self) -> np.ndarray:
        return self.to_dataframe()["volume"].to_numpy()

    def __len__(self) -> int:
        return len(self.candles)


def generate_synthetic_data(
    symbol: str = "BTC/USDT",
    timeframe: str = "1h",
    periods: int = 500,
    start_price: float = 30000.0,
    volatility: float = 0.015,
    seed: Optional[int] = 42,
) -> MarketData:
    """Generate synthetic OHLCV data for testing and backtesting."""
    rng = np.random.default_rng(seed)
    closes = [start_price]
    for _ in range(periods - 1):
        ret = rng.normal(0, volatility)
        closes.append(closes[-1] * (1 + ret))
    closes_arr = np.array(closes)

    noise = rng.uniform(0.001, 0.005, periods)
    opens = closes_arr * (1 + rng.normal(0, 0.002, periods))
    highs = np.maximum(opens, closes_arr) * (1 + noise)
    lows = np.minimum(opens, closes_arr) * (1 - noise)
    volumes = rng.uniform(100, 1000, periods)

    start = datetime(2024, 1, 1)
    delta = timedelta(hours=1) if timeframe == "1h" else timedelta(days=1)
    timestamps = [start + i * delta for i in range(periods)]

    candles = [
        Candle(timestamps[i], opens[i], highs[i], lows[i], closes_arr[i], volumes[i])
        for i in range(periods)
    ]
    return MarketData(symbol, timeframe, candles)
