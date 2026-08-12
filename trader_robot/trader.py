"""Paper trading runner — simulates real-time trading on live or synthetic data."""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Optional

from trader_robot.config import Config
from trader_robot.data import MarketData, generate_synthetic_data
from trader_robot.portfolio import OrderSide, Portfolio
from trader_robot.strategies import STRATEGIES, BaseStrategy, Signal

logger = logging.getLogger(__name__)


class PaperTrader:
    """
    Simulates a live trading loop using streaming candles.

    When running in 'paper' mode, data is replayed from a synthetic or
    historical dataset one candle at a time, mimicking real-time execution.
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        strategy_cls = STRATEGIES.get(config.strategy)
        if strategy_cls is None:
            raise ValueError(f"Unknown strategy: {config.strategy}. Available: {list(STRATEGIES)}")
        self.strategy: BaseStrategy = strategy_cls(**config.strategy_params)
        self.portfolio = Portfolio(config.initial_capital)
        self._seen_candles: list = []

    def run(
        self,
        data: Optional[MarketData] = None,
        max_candles: Optional[int] = None,
        sleep_seconds: float = 0.0,
    ) -> dict:
        """
        Replay candles one by one, generate signals, and execute paper orders.

        Args:
            data: Market data to replay. Defaults to synthetic data.
            max_candles: Stop after this many candles.
            sleep_seconds: Simulated delay between candles (for demo).
        """
        if data is None:
            data = generate_synthetic_data(
                self.config.symbol,
                self.config.timeframe,
                periods=200,
            )

        candles = data.candles
        if max_candles is not None:
            candles = candles[:max_candles]

        logger.info("Starting paper trading: %s | strategy=%s | candles=%d",
                    self.config.symbol, self.strategy.name, len(candles))

        for i, candle in enumerate(candles):
            self._seen_candles.append(candle)
            partial = MarketData(data.symbol, data.timeframe, self._seen_candles[:])
            signal = self.strategy.generate(partial)

            symbol = data.symbol
            price = candle.close
            pos = self.portfolio.positions.get(symbol)
            has_position = pos is not None and pos.is_open

            if signal.signal == Signal.BUY and not has_position:
                qty = (self.portfolio.cash * self.config.position_size_pct) / price
                order = self.portfolio.place_order(symbol, OrderSide.BUY, qty, price, candle.timestamp)
                self.portfolio.fill_order(order, price, candle.timestamp)
                logger.info("[%s] BUY  %.4f %s @ %.4f | %s", candle.timestamp, qty, symbol, price, signal.reason)

            elif signal.signal == Signal.SELL and has_position:
                qty = pos.quantity
                order = self.portfolio.place_order(symbol, OrderSide.SELL, qty, price, candle.timestamp)
                self.portfolio.fill_order(order, price, candle.timestamp)
                logger.info("[%s] SELL %.4f %s @ %.4f | %s", candle.timestamp, qty, symbol, price, signal.reason)

            equity = self.portfolio.equity({symbol: price})
            logger.debug("[%s] Candle %d/%d price=%.4f equity=%.2f signal=%s",
                         candle.timestamp, i + 1, len(candles), price, equity, signal.signal.value)

            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

        final_price = candles[-1].close if candles else 0.0
        summary = self.portfolio.summary({data.symbol: final_price})
        logger.info("Paper trading complete: %s", summary)
        return summary
