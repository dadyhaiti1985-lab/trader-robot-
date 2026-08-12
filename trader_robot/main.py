"""CLI entry point for trader robot V4."""
from __future__ import annotations

import argparse
import json
import logging
import sys

from trader_robot.backtest import Backtester
from trader_robot.config import Config
from trader_robot.data import generate_synthetic_data
from trader_robot.strategies import STRATEGIES
from trader_robot.trader import PaperTrader


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="trader-robot",
        description="Trader Robot V4 — Automated Trading System",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── backtest ──────────────────────────────────────────────────────────────
    bt = sub.add_parser("backtest", help="Run a backtest on synthetic/historical data")
    bt.add_argument("--strategy", choices=list(STRATEGIES), default="ma_crossover")
    bt.add_argument("--symbol", default="BTC/USDT")
    bt.add_argument("--timeframe", default="1h")
    bt.add_argument("--capital", type=float, default=10_000.0)
    bt.add_argument("--periods", type=int, default=500)
    bt.add_argument("--seed", type=int, default=42)
    bt.add_argument("--log-level", default="INFO")
    bt.add_argument("--json", action="store_true", help="Output results as JSON")
    # MA Crossover params
    bt.add_argument("--fast", type=int, default=10)
    bt.add_argument("--slow", type=int, default=30)
    # RSI params
    bt.add_argument("--rsi-period", type=int, default=14)
    bt.add_argument("--oversold", type=float, default=30.0)
    bt.add_argument("--overbought", type=float, default=70.0)

    # ── paper-trade ───────────────────────────────────────────────────────────
    pt = sub.add_parser("paper-trade", help="Run paper trading simulation")
    pt.add_argument("--strategy", choices=list(STRATEGIES), default="ma_crossover")
    pt.add_argument("--symbol", default="BTC/USDT")
    pt.add_argument("--timeframe", default="1h")
    pt.add_argument("--capital", type=float, default=10_000.0)
    pt.add_argument("--candles", type=int, default=200)
    pt.add_argument("--log-level", default="INFO")
    # MA Crossover params
    pt.add_argument("--fast", type=int, default=10)
    pt.add_argument("--slow", type=int, default=30)
    # RSI params
    pt.add_argument("--rsi-period", type=int, default=14)
    pt.add_argument("--oversold", type=float, default=30.0)
    pt.add_argument("--overbought", type=float, default=70.0)

    # ── list-strategies ───────────────────────────────────────────────────────
    sub.add_parser("list-strategies", help="List available strategies")

    return parser


def _strategy_params(args: argparse.Namespace) -> dict:
    strategy = args.strategy
    if strategy == "ma_crossover":
        return {"fast": args.fast, "slow": args.slow}
    if strategy == "rsi":
        return {"period": args.rsi_period, "oversold": args.oversold, "overbought": args.overbought}
    return {}


def cmd_backtest(args: argparse.Namespace) -> None:
    _setup_logging(args.log_level)
    config = Config(
        initial_capital=args.capital,
        symbol=args.symbol,
        timeframe=args.timeframe,
        strategy=args.strategy,
        strategy_params=_strategy_params(args),
    )
    data = generate_synthetic_data(
        symbol=config.symbol,
        timeframe=config.timeframe,
        periods=args.periods,
        seed=args.seed,
    )
    strategy_cls = STRATEGIES[config.strategy]
    strategy = strategy_cls(**config.strategy_params)
    engine = Backtester(
        strategy=strategy,
        initial_capital=config.initial_capital,
        position_size_pct=config.position_size_pct,
        slippage_pct=config.slippage_pct,
        commission_pct=config.commission_pct,
    )
    result = engine.run(data)

    if args.json:
        print(json.dumps({
            "symbol": result.symbol,
            "strategy": result.strategy_name,
            "initial_capital": result.initial_capital,
            "final_equity": result.final_equity,
            "total_pnl": result.total_pnl,
            "total_pnl_pct": result.total_pnl_pct,
            "max_drawdown_pct": result.max_drawdown_pct,
            "sharpe_ratio": result.sharpe_ratio,
            "total_trades": result.total_trades,
            "win_rate": result.win_rate,
        }, indent=2))
    else:
        print("\n" + str(result) + "\n")


def cmd_paper_trade(args: argparse.Namespace) -> None:
    _setup_logging(args.log_level)
    config = Config(
        initial_capital=args.capital,
        symbol=args.symbol,
        timeframe=args.timeframe,
        strategy=args.strategy,
        strategy_params=_strategy_params(args),
    )
    trader = PaperTrader(config)
    data = generate_synthetic_data(
        symbol=config.symbol,
        timeframe=config.timeframe,
        periods=args.candles,
    )
    summary = trader.run(data=data)
    print("\nPaper Trading Summary:")
    print(json.dumps(summary, indent=2, default=str))


def cmd_list_strategies(_args: argparse.Namespace) -> None:
    print("Available strategies:")
    for name, cls in STRATEGIES.items():
        print(f"  {name:20s} — {cls.__doc__.strip().splitlines()[0] if cls.__doc__ else ''}")


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    commands = {
        "backtest": cmd_backtest,
        "paper-trade": cmd_paper_trade,
        "list-strategies": cmd_list_strategies,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
