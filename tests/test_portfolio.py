"""Tests for portfolio management."""
from datetime import datetime

import pytest

from trader_robot.portfolio import Order, OrderSide, OrderStatus, Portfolio


@pytest.fixture
def portfolio():
    return Portfolio(initial_capital=10_000.0)


@pytest.fixture
def now():
    return datetime(2024, 1, 15, 10, 0, 0)


class TestPortfolio:
    def test_initial_state(self, portfolio):
        assert portfolio.cash == 10_000.0
        assert portfolio.positions == {}
        assert portfolio.orders == []

    def test_buy_order(self, portfolio, now):
        order = portfolio.place_order("BTC/USDT", OrderSide.BUY, 0.1, 30000.0, now)
        portfolio.fill_order(order, 30000.0, now)
        assert order.status == OrderStatus.FILLED
        assert portfolio.cash == pytest.approx(10_000.0 - 3000.0)
        pos = portfolio.positions["BTC/USDT"]
        assert pos.quantity == pytest.approx(0.1)
        assert pos.avg_entry_price == pytest.approx(30000.0)

    def test_sell_order_after_buy(self, portfolio, now):
        buy = portfolio.place_order("BTC/USDT", OrderSide.BUY, 0.1, 30000.0, now)
        portfolio.fill_order(buy, 30000.0, now)

        sell = portfolio.place_order("BTC/USDT", OrderSide.SELL, 0.1, 35000.0, now)
        portfolio.fill_order(sell, 35000.0, now)

        pos = portfolio.positions["BTC/USDT"]
        assert pos.quantity == pytest.approx(0.0)
        assert pos.realized_pnl == pytest.approx(500.0)

    def test_insufficient_cash_cancels_order(self, portfolio, now):
        order = portfolio.place_order("BTC/USDT", OrderSide.BUY, 1000.0, 30000.0, now)
        portfolio.fill_order(order, 30000.0, now)
        assert order.status == OrderStatus.CANCELLED

    def test_insufficient_position_cancels_sell(self, portfolio, now):
        sell = portfolio.place_order("BTC/USDT", OrderSide.SELL, 1.0, 30000.0, now)
        portfolio.fill_order(sell, 30000.0, now)
        assert sell.status == OrderStatus.CANCELLED

    def test_equity_calculation(self, portfolio, now):
        order = portfolio.place_order("BTC/USDT", OrderSide.BUY, 0.1, 30000.0, now)
        portfolio.fill_order(order, 30000.0, now)
        equity = portfolio.equity({"BTC/USDT": 35000.0})
        assert equity == pytest.approx(7_000.0 + 3_500.0)  # cash + position value

    def test_summary(self, portfolio, now):
        summary = portfolio.summary({"BTC/USDT": 30000.0})
        assert summary["initial_capital"] == 10_000.0
        assert summary["cash"] == 10_000.0
        assert summary["total_trades"] == 0
