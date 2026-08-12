"""Tests for technical indicators."""
import numpy as np
import pytest

from trader_robot.indicators import atr, bollinger_bands, ema, macd, rsi, sma


class TestSMA:
    def test_basic(self):
        values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        result = sma(values, 3)
        assert np.isnan(result[0])
        assert np.isnan(result[1])
        assert result[2] == pytest.approx(2.0)
        assert result[3] == pytest.approx(3.0)
        assert result[4] == pytest.approx(4.0)

    def test_period_equals_length(self):
        values = np.array([2.0, 4.0, 6.0])
        result = sma(values, 3)
        assert result[2] == pytest.approx(4.0)

    def test_period_1(self):
        values = np.arange(5.0)
        result = sma(values, 1)
        np.testing.assert_array_equal(result, values)


class TestEMA:
    def test_basic(self):
        values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        result = ema(values, 3)
        assert np.isnan(result[0])
        assert np.isnan(result[1])
        assert not np.isnan(result[2])

    def test_longer_than_period(self):
        values = np.ones(20)
        result = ema(values, 5)
        # EMA of constant series should converge to the constant
        assert result[19] == pytest.approx(1.0, abs=1e-6)


class TestRSI:
    def test_returns_correct_length(self):
        values = np.random.default_rng(0).uniform(100, 200, 50)
        result = rsi(values, 14)
        assert len(result) == 50

    def test_rsi_bounds(self):
        values = np.random.default_rng(1).uniform(100, 200, 100)
        result = rsi(values, 14)
        valid = result[~np.isnan(result)]
        assert (valid >= 0).all()
        assert (valid <= 100).all()

    def test_increasing_series_high_rsi(self):
        values = np.linspace(1.0, 100.0, 100)
        result = rsi(values, 14)
        valid = result[~np.isnan(result)]
        assert valid[-1] > 90  # strong uptrend → RSI near 100

    def test_insufficient_data(self):
        result = rsi(np.array([1.0, 2.0]), 14)
        assert np.all(np.isnan(result))


class TestBollingerBands:
    def test_shape(self):
        values = np.random.default_rng(2).uniform(100, 200, 50)
        upper, middle, lower = bollinger_bands(values, 20, 2.0)
        assert len(upper) == 50
        assert len(middle) == 50
        assert len(lower) == 50

    def test_ordering(self):
        values = np.random.default_rng(3).uniform(100, 200, 50)
        upper, middle, lower = bollinger_bands(values, 20, 2.0)
        valid = ~np.isnan(upper)
        assert (upper[valid] >= middle[valid]).all()
        assert (middle[valid] >= lower[valid]).all()


class TestMACD:
    def test_shape(self):
        values = np.random.default_rng(4).uniform(100, 200, 100)
        ml, sl, hist = macd(values, 12, 26, 9)
        assert len(ml) == len(values)
        assert len(sl) == len(values)
        assert len(hist) == len(values)

    def test_histogram_equals_diff(self):
        values = np.random.default_rng(5).uniform(100, 200, 100)
        ml, sl, hist = macd(values, 12, 26, 9)
        valid = ~(np.isnan(ml) | np.isnan(sl))
        np.testing.assert_allclose(hist[valid], (ml - sl)[valid])


class TestATR:
    def test_shape(self):
        rng = np.random.default_rng(6)
        closes = rng.uniform(100, 200, 50)
        highs = closes + rng.uniform(0, 5, 50)
        lows = closes - rng.uniform(0, 5, 50)
        result = atr(highs, lows, closes, 14)
        assert len(result) == 50

    def test_positive_values(self):
        rng = np.random.default_rng(7)
        closes = rng.uniform(100, 200, 50)
        highs = closes + rng.uniform(0, 5, 50)
        lows = closes - rng.uniform(0, 5, 50)
        result = atr(highs, lows, closes, 14)
        valid = result[~np.isnan(result)]
        assert (valid > 0).all()
