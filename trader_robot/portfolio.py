"""Order and portfolio management."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderStatus(Enum):
    OPEN = "OPEN"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"


@dataclass
class Order:
    order_id: str
    symbol: str
    side: OrderSide
    quantity: float
    price: float
    timestamp: datetime
    status: OrderStatus = OrderStatus.OPEN
    fill_price: Optional[float] = None
    fill_timestamp: Optional[datetime] = None

    @property
    def value(self) -> float:
        p = self.fill_price if self.fill_price is not None else self.price
        return self.quantity * p


@dataclass
class Position:
    symbol: str
    quantity: float = 0.0
    avg_entry_price: float = 0.0
    realized_pnl: float = 0.0

    @property
    def is_open(self) -> bool:
        return self.quantity > 0

    def unrealized_pnl(self, current_price: float) -> float:
        return (current_price - self.avg_entry_price) * self.quantity

    def total_pnl(self, current_price: float) -> float:
        return self.realized_pnl + self.unrealized_pnl(current_price)


class Portfolio:
    """Tracks cash balance, positions, and order history."""

    def __init__(self, initial_capital: float = 10_000.0) -> None:
        self.initial_capital = initial_capital
        self.cash: float = initial_capital
        self.positions: dict[str, Position] = {}
        self.orders: list[Order] = []
        self._order_counter: int = 0

    def _next_id(self) -> str:
        self._order_counter += 1
        return f"ORD-{self._order_counter:06d}"

    def place_order(
        self,
        symbol: str,
        side: OrderSide,
        quantity: float,
        price: float,
        timestamp: datetime,
    ) -> Order:
        order = Order(
            order_id=self._next_id(),
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=price,
            timestamp=timestamp,
        )
        self.orders.append(order)
        return order

    def fill_order(self, order: Order, fill_price: float, fill_timestamp: datetime) -> None:
        if order.status != OrderStatus.OPEN:
            raise ValueError(f"Order {order.order_id} is not open")

        order.fill_price = fill_price
        order.fill_timestamp = fill_timestamp
        order.status = OrderStatus.FILLED

        symbol = order.symbol
        pos = self.positions.setdefault(symbol, Position(symbol))

        if order.side == OrderSide.BUY:
            cost = fill_price * order.quantity
            if cost > self.cash:
                logger.warning("Insufficient cash: need %.2f, have %.2f", cost, self.cash)
                order.status = OrderStatus.CANCELLED
                return
            total_qty = pos.quantity + order.quantity
            pos.avg_entry_price = (
                (pos.avg_entry_price * pos.quantity + fill_price * order.quantity) / total_qty
                if total_qty > 0
                else fill_price
            )
            pos.quantity = total_qty
            self.cash -= cost
            logger.info("BUY %.4f %s @ %.4f  cash=%.2f", order.quantity, symbol, fill_price, self.cash)
        else:
            if pos.quantity < order.quantity:
                logger.warning("Insufficient position: need %.4f, have %.4f", order.quantity, pos.quantity)
                order.status = OrderStatus.CANCELLED
                return
            proceeds = fill_price * order.quantity
            pnl = (fill_price - pos.avg_entry_price) * order.quantity
            pos.realized_pnl += pnl
            pos.quantity -= order.quantity
            if pos.quantity == 0:
                pos.avg_entry_price = 0.0
            self.cash += proceeds
            logger.info(
                "SELL %.4f %s @ %.4f  pnl=%.2f  cash=%.2f",
                order.quantity, symbol, fill_price, pnl, self.cash,
            )

    def equity(self, prices: dict[str, float]) -> float:
        total = self.cash
        for symbol, pos in self.positions.items():
            if pos.is_open and symbol in prices:
                total += pos.quantity * prices[symbol]
        return total

    def total_pnl(self, prices: dict[str, float]) -> float:
        return self.equity(prices) - self.initial_capital

    def summary(self, prices: dict[str, float]) -> dict:
        eq = self.equity(prices)
        return {
            "initial_capital": self.initial_capital,
            "cash": self.cash,
            "equity": eq,
            "total_pnl": eq - self.initial_capital,
            "total_pnl_pct": (eq - self.initial_capital) / self.initial_capital * 100,
            "positions": {
                sym: {
                    "quantity": pos.quantity,
                    "avg_entry": pos.avg_entry_price,
                    "unrealized_pnl": pos.unrealized_pnl(prices.get(sym, pos.avg_entry_price)),
                    "realized_pnl": pos.realized_pnl,
                }
                for sym, pos in self.positions.items()
                if pos.is_open
            },
            "total_trades": sum(1 for o in self.orders if o.status == OrderStatus.FILLED),
        }
