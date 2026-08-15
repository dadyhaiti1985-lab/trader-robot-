/**
 * Strategy API routes
 * GET  /strategy/analyze    - analyze current market with advanced engine
 * POST /strategy/backtest   - run backtest on provided candles
 * GET  /strategy/performance - get performance stats from trade history
 */
import express from 'express';
import logger from '../utils/logger.js';
import AdvancedStrategyEngine from '../strategies/advancedStrategyEngine.js';
import SignalGenerator from '../strategies/signalGenerator.js';
import RiskManager from '../strategies/riskManager.js';
import NewsFilter from '../strategies/newsFilter.js';
import { StrategyAnalyzer } from '../strategies/strategyAnalyzer.js';
import { runBacktest } from '../strategies/backtestEngine.js';
import OracleTraderProStrategy from '../strategies/oracleTraderProStrategy.js';
import pb from '../utils/pbClient.js';

const router = express.Router();
const strategyEngine = new AdvancedStrategyEngine();
const signalGen = new SignalGenerator();
const riskMgr = new RiskManager();
const newsFilter = new NewsFilter();
const analyzer = new StrategyAnalyzer();
const oracleStrategy = new OracleTraderProStrategy(0.02, 2.0);
const MAX_CANDLES = 5000;

/**
 * Enforces finite numeric values and optional bounds.
 */
function validateNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) {
    return `${name} must be a finite number between ${min} and ${max}`;
  }
  return null;
}

/**
 * POST /strategy/analyze
 * Body: { candles: [{open,high,low,close,volume}], newsEvents: [], accountBalance, riskPercent }
 */
router.post('/analyze', async (req, res) => {
  const { candles, newsEvents = [], accountBalance = 10000, riskPercent = 1.5, riskRewardRatio = 2 } = req.body || {};

  if (!candles || !Array.isArray(candles) || candles.length < 30 || candles.length > MAX_CANDLES) {
    return res.status(422).json({ error: `candles array with 30 to ${MAX_CANDLES} entries required` });
  }

  const numericErrors = [
    validateNumber(accountBalance, 'accountBalance', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    validateNumber(riskPercent, 'riskPercent', { min: 0.01, max: 100 }),
    validateNumber(riskRewardRatio, 'riskRewardRatio', { min: 0.1, max: 100 }),
  ].filter(Boolean);
  if (numericErrors.length > 0) {
    return res.status(422).json({ error: numericErrors[0] });
  }

  const indicators = strategyEngine.calculateIndicators(candles);
  if (!indicators) {
    return res.status(422).json({ error: 'Insufficient candle data for analysis' });
  }

  const price = indicators.currentPrice;
  const newsBlocked = newsFilter.shouldBlockTrade(newsEvents);
  const nearestEvent = newsFilter.getNearestEvent(newsEvents);
  const buySignal = !newsBlocked ? signalGen.generateBuySignal(indicators, { price }) : null;
  const sellSignal = !newsBlocked ? signalGen.generateSellSignal(indicators, { price }) : null;

  let tradePlan = null;
  let activeSignal = null;

  if (buySignal && buySignal.confidence >= 80) {
    activeSignal = buySignal;
    tradePlan = riskMgr.buildTradePlan({ entryPrice: price, atr: indicators.atr, direction: 'BUY', accountBalance, riskPercent, riskRewardRatio });
  } else if (sellSignal && sellSignal.confidence >= 80) {
    activeSignal = sellSignal;
    tradePlan = riskMgr.buildTradePlan({ entryPrice: price, atr: indicators.atr, direction: 'SELL', accountBalance, riskPercent, riskRewardRatio });
  }

  const recommendation = newsBlocked ? 'HOLD' : activeSignal ? activeSignal.signal : 'HOLD';
  const reason = newsBlocked ? 'High-impact news event nearby — trade blocked'
    : activeSignal ? `${activeSignal.passedCount}/${activeSignal.totalConditions} conditions passed`
    : 'Insufficient signal confluence — waiting for setup';

  res.json({
    success: true,
    recommendation,
    reason,
    confidence: activeSignal?.confidence || signalGen.calculateConfidence(indicators),
    newsBlocked,
    nearestEvent,
    indicators: {
      rsi: indicators.rsi,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      emaUptrend: indicators.emaUptrend,
      macd: indicators.macd,
      adx: indicators.adx,
      atr: indicators.atr,
      vwap: indicators.vwap,
      volumeConfirm: indicators.volumeConfirm,
      bollingerBands: indicators.bollingerBands,
      support: indicators.support,
      resistance: indicators.resistance,
      fibonacci: indicators.fibonacci,
    },
    signal: activeSignal,
    tradePlan,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /strategy/backtest
 * Body: { candles, accountBalance, riskPercent, riskRewardRatio, minConfidence }
 */
router.post('/backtest', async (req, res) => {
  const { candles, ...options } = req.body || {};

  if (!candles || !Array.isArray(candles) || candles.length < 100 || candles.length > MAX_CANDLES) {
    return res.status(422).json({ error: `candles array with 100 to ${MAX_CANDLES} entries required for backtesting` });
  }

  const numericErrors = [
    options.accountBalance === undefined ? null : validateNumber(options.accountBalance, 'accountBalance', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    options.initialCapital === undefined ? null : validateNumber(options.initialCapital, 'initialCapital', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    options.riskPerTrade === undefined ? null : validateNumber(options.riskPerTrade, 'riskPerTrade', { min: 0.0001, max: 1 }),
    options.stopLossPct === undefined ? null : validateNumber(options.stopLossPct, 'stopLossPct', { min: 0.0001, max: 1 }),
    options.takeProfitPct === undefined ? null : validateNumber(options.takeProfitPct, 'takeProfitPct', { min: 0.0001, max: 10 }),
    options.riskPercent === undefined ? null : validateNumber(options.riskPercent, 'riskPercent', { min: 0.01, max: 100 }),
    options.riskRewardRatio === undefined ? null : validateNumber(options.riskRewardRatio, 'riskRewardRatio', { min: 0.1, max: 100 }),
    options.minConfidence === undefined ? null : validateNumber(options.minConfidence, 'minConfidence', { min: 0, max: 100 }),
  ].filter(Boolean);
  if (numericErrors.length > 0) {
    return res.status(422).json({ error: numericErrors[0] });
  }

  try {
    const report = runBacktest(candles, options);
    return res.json({ success: true, ...report });
  } catch (error) {
    logger.warn(`[strategy/backtest] Validation failed: ${error.message}`);
    return res.status(422).json({ error: error.message });
  }
});

/**
 * GET /strategy/performance?userId=xxx
 */
router.get('/performance', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(422).json({ error: 'userId required' });

  try {
    const result = await pb.collection('trades').getFullList({ filter: `userId = "${userId}"`, sort: '-created' });
    const stats = analyzer.analyze(result);
    res.json({ success: true, ...stats });
  } catch (err) {
    logger.error(`[/strategy/performance] ${err.message}`);
    res.json({ success: true, totalTrades: 0, winRate: 0, profitFactor: 0, sharpeRatio: 0, maxDrawdown: 0 });
  }
});

/**
 * POST /strategy/evaluate
 * Oracle Trader Pro — direct port of the Python OracleTraderPro.evaluate()
 * Body: { candles: [{open,high,low,close,volume}], aiConfidence?, accountBalance?, riskPerTradePct?, rrRatio? }
 */
router.post('/evaluate', async (req, res) => {
  const {
    candles,
    aiConfidence = 0.95,
    accountBalance = 10000,
    riskPerTradePct,
    rrRatio,
  } = req.body || {};

  if (!candles || !Array.isArray(candles) || candles.length < 60 || candles.length > MAX_CANDLES) {
    return res.status(422).json({ error: `candles array with 60 to ${MAX_CANDLES} entries required` });
  }

  const numericErrors = [
    validateNumber(aiConfidence, 'aiConfidence', { min: 0, max: 1 }),
    validateNumber(accountBalance, 'accountBalance', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    riskPerTradePct === undefined ? null : validateNumber(riskPerTradePct, 'riskPerTradePct', { min: 0.0001, max: 1 }),
    rrRatio === undefined ? null : validateNumber(rrRatio, 'rrRatio', { min: 0.1, max: 100 }),
  ].filter(Boolean);
  if (numericErrors.length > 0) {
    return res.status(422).json({ error: numericErrors[0] });
  }

  // Allow per-request overrides of risk/RR
  let strategy = oracleStrategy;
  if (riskPerTradePct !== undefined || rrRatio !== undefined) {
    strategy = new OracleTraderProStrategy(
      riskPerTradePct ?? 0.02,
      rrRatio ?? 2.0,
    );
  }

  const result = strategy.evaluate(candles, Number(aiConfidence), Number(accountBalance));
  res.json({ success: true, ...result, timestamp: new Date().toISOString() });
});

export default router;
