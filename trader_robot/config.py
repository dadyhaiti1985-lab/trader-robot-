"""Configuration management for trader robot V4."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


@dataclass
class Config:
    """Runtime configuration for the trading robot."""

    # Capital
    initial_capital: float = float(os.getenv("INITIAL_CAPITAL", "10000"))

    # Trading
    symbol: str = os.getenv("SYMBOL", "BTC/USDT")
    timeframe: str = os.getenv("TIMEFRAME", "1h")
    strategy: str = os.getenv("STRATEGY", "ma_crossover")

    # Risk
    position_size_pct: float = float(os.getenv("POSITION_SIZE_PCT", "0.95"))
    slippage_pct: float = float(os.getenv("SLIPPAGE_PCT", "0.001"))
    commission_pct: float = float(os.getenv("COMMISSION_PCT", "0.001"))

    # Strategy parameters (nested)
    strategy_params: dict = field(default_factory=dict)

    # Exchange (for live / paper trading)
    exchange: str = os.getenv("EXCHANGE", "paper")
    api_key: Optional[str] = os.getenv("API_KEY")
    api_secret: Optional[str] = os.getenv("API_SECRET")

    # Logging
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
