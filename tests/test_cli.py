"""Tests for the CLI entry point."""
import json

import pytest

from trader_robot.main import main


class TestCLI:
    def test_list_strategies(self, capsys):
        main(["list-strategies"])
        captured = capsys.readouterr()
        assert "ma_crossover" in captured.out
        assert "rsi" in captured.out

    def test_backtest_text_output(self, capsys):
        main(["backtest", "--strategy", "ma_crossover", "--periods", "100", "--log-level", "WARNING"])
        captured = capsys.readouterr()
        assert "Strategy" in captured.out

    def test_backtest_json_output(self, capsys):
        main(["backtest", "--strategy", "rsi", "--periods", "100", "--json", "--log-level", "WARNING"])
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert "total_pnl" in data
        assert "sharpe_ratio" in data

    def test_paper_trade(self, capsys):
        main(["paper-trade", "--candles", "60", "--log-level", "WARNING"])
        captured = capsys.readouterr()
        assert "Paper Trading Summary" in captured.out

    def test_backtest_bollinger(self, capsys):
        main(["backtest", "--strategy", "bollinger", "--periods", "150", "--log-level", "WARNING"])
        captured = capsys.readouterr()
        assert "Strategy" in captured.out

    def test_backtest_macd(self, capsys):
        main(["backtest", "--strategy", "macd", "--periods", "150", "--log-level", "WARNING"])
        captured = capsys.readouterr()
        assert "Strategy" in captured.out
