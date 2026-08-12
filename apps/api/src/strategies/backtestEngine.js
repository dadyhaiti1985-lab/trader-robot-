/**
 * Minimal backtest engine — runs a simple signal-based simulation on candle data.
 */

function isValidNumber(value) {
	return Number.isFinite(Number(value));
}

/**
 * Validates candles and options to avoid runtime failures.
 */
function validateBacktestInputs(candles, options) {
	if (!Array.isArray(candles) || candles.length === 0) {
		throw new Error('candles must be a non-empty array');
	}

	if (candles.length < 21) {
		throw new Error('candles array must contain at least 21 entries');
	}

	const invalidCandle = candles.find((candle) => !isValidNumber(candle?.close));
	if (invalidCandle) {
		throw new Error('each candle.close must be a finite number');
	}

	const riskPerTrade = Number(options?.riskPerTrade ?? 0.02);
	const stopLossPct = Number(options?.stopLossPct ?? 0.02);
	const takeProfitPct = Number(options?.takeProfitPct ?? 0.05);
	const initialCapital = Number(options?.initialCapital ?? 10000);

	if (!(initialCapital > 0)) {
		throw new Error('initialCapital must be greater than 0');
	}
	if (!(riskPerTrade > 0)) {
		throw new Error('riskPerTrade must be greater than 0');
	}
	if (!(stopLossPct > 0)) {
		throw new Error('stopLossPct must be greater than 0');
	}
	if (!(takeProfitPct > 0)) {
		throw new Error('takeProfitPct must be greater than 0');
	}
}

export function runBacktest(candles, options = {}) {
	validateBacktestInputs(candles, options);

	const {
		initialCapital = 10000,
		riskPerTrade = 0.02,
		stopLossPct = 0.02,
		takeProfitPct = 0.05,
	} = options;

	let capital = initialCapital;
	const trades = [];

	for (let i = 20; i < candles.length - 1; i++) {
		const slice = candles.slice(i - 20, i + 1);
		const closes = slice.map((c) => Number(c.close));
		if (closes.length === 0) continue;
		const sma = closes.reduce((s, v) => s + v, 0) / closes.length;
		const price = closes[closes.length - 1];
		if (!(price > 0)) continue;
		const signal = price > sma ? 'buy' : price < sma ? 'sell' : null;
		if (!signal) continue;

		const denominator = price * stopLossPct;
		if (!(denominator > 0)) continue;
		const size = (capital * riskPerTrade) / denominator;
		if (!Number.isFinite(size) || size <= 0) continue;
		const entry = price;
		const exitPrice = signal === 'buy'
			? entry * (1 + takeProfitPct)
			: entry * (1 - takeProfitPct);
		const pnl = signal === 'buy'
			? (exitPrice - entry) * size
			: (entry - exitPrice) * size;

		capital += pnl;
		trades.push({ signal, entry, exit: exitPrice, pnl: Number(pnl.toFixed(2)), capitalAfter: Number(capital.toFixed(2)) });

		// skip a few candles after each trade
		i += 5;
	}

	const wins = trades.filter((t) => t.pnl > 0).length;
	const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

	return {
		initialCapital,
		finalCapital: Number(capital.toFixed(2)),
		totalPnl: Number(totalPnl.toFixed(2)),
		totalTrades: trades.length,
		winRate: trades.length ? Number(((wins / trades.length) * 100).toFixed(1)) : 0,
		trades: trades.slice(-50),
	};
}
