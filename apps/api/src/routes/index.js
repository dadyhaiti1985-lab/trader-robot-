import { Router } from 'express';
import healthCheck from './health-check.js';
import healthDetailed from './health-detailed.js';
import systemHealth from './system-health.js';
import supabaseHealth from './supabase-health.js';
import botRouter from './bot.js';
import coinbaseRouter from './coinbase.js';
import tradesRouter from './trades.js';
import backtestRouter from './backtest.js';
import integratedAiRouter from './integrated-ai.js';
import aiTradingRouter from './ai-trading.js';
import strategyRouter from './strategy.js';
import subscriptionsRouter from './ecommerce/subscriptions.js';
import authMiddleware from '../middleware/auth.js';
import oracleTraderProRouter from './oracle-trader-pro.js';
import authMeHandler from './auth-me.js';
import userBalanceRouter from './user-balance.js';
import userCredentialsRouter from './user-credentials.js';
import webhooksRouter from './webhooks.js';
import botToggleRouter from './bot-toggle.js';
import aiSignalsRouter from './ai-signals.js';
import economicCalendarRouter from './economic-calendar.js';
import { licenseGuardMiddleware } from '../middleware/license-guard.js';
import { apiBurstLimiter, authRouteLimiter, webhookRouteLimiter } from '../middleware/security-rate-limits.js';

export default function routes() {
  const router = Router();

  // Health check endpoint
  router.get('/health', healthCheck);
  router.get('/health/detailed', healthDetailed);
  router.get('/system-health', systemHealth);
  router.get('/supabase-health', supabaseHealth);

  // Current user info with admin/role status
  router.get('/auth/me', authRouteLimiter, ...authMeHandler);

  // Subscription management (Oracle-Trader-Pro $35/mo tier + others)
  router.use('/ecommerce/subscriptions', authMiddleware, subscriptionsRouter);

  // Oracle-Trader-Pro: per-user encrypted exchange credentials + isolated trades
  router.use('/oracle-trader-pro', apiBurstLimiter, licenseGuardMiddleware, oracleTraderProRouter);

  // Real-time user account balance (fetches from connected exchange)
  router.use('/user/balance', apiBurstLimiter, userBalanceRouter);
  router.use('/user/save-credentials', apiBurstLimiter, userCredentialsRouter);

  // Coinbase CDP webhooks (no auth middleware — signature verified internally)
  router.use('/webhooks', webhookRouteLimiter, webhooksRouter);

  // Dedicated bot toggle (independent of Coinbase credentials)
  router.use('/bot/toggle', botToggleRouter);

  // AI signal execution with order management
  router.use('/ai-signals', licenseGuardMiddleware, aiSignalsRouter);

  // Bot trading routes
  router.use('/bot', botRouter);

  // Coinbase routes
  router.use('/coinbase', coinbaseRouter);

  // Trades routes
  router.use('/bot/trades', tradesRouter);

  // Backtest routes
  router.use('/bot/backtest', backtestRouter);

  // Integrated AI chat (streaming)
  router.use('/integrated-ai', integratedAiRouter);

  // Autonomous AI trading agent
  router.use('/ai', apiBurstLimiter, aiTradingRouter);

  // Advanced multi-indicator strategy engine
  router.use('/strategy', strategyRouter);

	// Economic calendar feed for macro view / caution flagging
	router.use('/economic-calendar', economicCalendarRouter);

  return router;
}