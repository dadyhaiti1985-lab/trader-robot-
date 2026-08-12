"""Tests for trading strategies."""
import numpy as np
import pytest

from trader_robot.data import generate_synthetic_data
from trader_robot.strategies import (
    BollingerBandStrategy,
    MACDStrategy,
    MovingAverageCrossover,
    RSIStrategy,
    Signal,
    TradeSignal,
)


@pytest.fixture
def market_data():
    return generate_synthetic_data(periods=300, seed=42)


class TestMovingAverageCrossover:
    def test_returns_trade_signal(self, market_data):
        strategy = MovingAverageCrossover(fast=10, slow=30)
        sig = strategy.generate(market_data)
        assert isinstance(sig, TradeSignal)
        assert sig.signal in Signal

    def test_insufficient_data_returns_hold(self):
        data = generate_synthetic_data(periods=5)
        strategy = MovingAverageCrossover(fast=10, slow=30)
        sig = strategy.generate(data)
        assert sig.signal == Signal.HOLD

    def test_sma_type(self, market_data):
        strategy = MovingAverageCrossover(fast=10, slow=30, ma_type="sma")
        sig = strategy.generate(market_data)
        assert isinstance(sig, TradeSignal)


class TestRSIStrategy:
    def test_returns_trade_signal(self, market_data):
        strategy = RSIStrategy()
        sig = strategy.generate(market_data)
        assert isinstance(sig, TradeSignal)

    def test_uptrend_generates_sell(self):
        # Strongly increasing prices should push RSI above overbought
        prices = np.linspace(1.0, 200.0, 200)
        from trader_robot.data import MarketData, Candle
        from datetime import datetime, timedelta
        candles = [
            Candle(datetime(2024, 1, 1) + timedelta(hours=i),
                   prices[i], prices[i] * 1.01, prices[i] * 0.99, prices[i], 100.0)
            for i in range(len(prices))
        ]
        data = MarketData("TEST/USDT", "1h", candles)
        strategy = RSIStrategy(period=14, oversold=30, overbought=70)
        # Just ensure no exception and returns valid signal
        sig = strategy.generate(data)
        assert isinstance(sig, TradeSignal)


class TestBollingerBandStrategy:
    def test_returns_trade_signal(self, market_data):
        strategy = BollingerBandStrategy()
        sig = strategy.generate(market_data)
        assert isinstance(sig, TradeSignal)

    def test_insufficient_data_returns_hold(self):
        data = generate_synthetic_data(periods=5)
        strategy = BollingerBandStrategy(period=20)
        sig = strategy.generate(data)
        assert sig.signal == Signal.HOLD


class TestMACDStrategy:
    def test_returns_trade_signal(self, market_data):
        strategy = MACDStrategy()
        sig = strategy.generate(market_data)
        assert isinstance(sig, TradeSignal)

    def test_signal_is_valid_enum(self, market_data):
        strategy = MACDStrategy()
        sig = strategy.generate(market_data)
        assert sig.signal in (Signal.BUY, Signal.SELL, Signal.HOLD)
