"""Tests for the backtesting engine."""
import pytest

from trader_robot.backtest import Backtester
from trader_robot.data import generate_synthetic_data
from trader_robot.strategies import (
    BollingerBandStrategy,
    MACDStrategy,
    MovingAverageCrossover,
    RSIStrategy,
)


@pytest.fixture
def market_data():
    return generate_synthetic_data(periods=300, seed=42)


class TestBacktester:
    def test_ma_crossover_result(self, market_data):
        strategy = MovingAverageCrossover(fast=10, slow=30)
        bt = Backtester(strategy, initial_capital=10_000.0)
        result = bt.run(market_data)
        assert result.initial_capital == 10_000.0
        assert result.final_equity > 0
        assert result.total_trades >= 0
        assert 0 <= result.win_rate <= 100

    def test_rsi_strategy(self, market_data):
        strategy = RSIStrategy()
        bt = Backtester(strategy, initial_capital=10_000.0)
        result = bt.run(market_data)
        assert result.strategy_name == "rsi"

    def test_bollinger_strategy(self, market_data):
        strategy = BollingerBandStrategy()
        bt = Backtester(strategy, initial_capital=10_000.0)
        result = bt.run(market_data)
        assert result.strategy_name == "bollinger"

    def test_macd_strategy(self, market_data):
        strategy = MACDStrategy()
        bt = Backtester(strategy, initial_capital=10_000.0)
        result = bt.run(market_data)
        assert result.strategy_name == "macd"

    def test_equity_curve_length(self, market_data):
        strategy = MovingAverageCrossover()
        bt = Backtester(strategy)
        result = bt.run(market_data)
        assert len(result.equity_curve) == len(market_data)

    def test_result_str(self, market_data):
        strategy = MovingAverageCrossover()
        bt = Backtester(strategy)
        result = bt.run(market_data)
        s = str(result)
        assert "Strategy" in s
        assert "P&L" in s

    def test_max_drawdown_non_negative(self, market_data):
        strategy = MovingAverageCrossover()
        bt = Backtester(strategy)
        result = bt.run(market_data)
        assert result.max_drawdown_pct >= 0
