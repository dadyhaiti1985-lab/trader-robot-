import express from 'express';
import logger from '../utils/logger.js';
import * as coinbase from '../utils/coinbase.js';
import authMiddleware from '../middleware/auth.js';
import { getCoinbaseFillHistory } from '../services/coinbase-fills.js';
import { validateSymbolQuery } from '../middleware/request-validation.js';
import {
  PRICE_CACHE_TTL_MS,
  COINBASE_RATE_LIMIT_MAX_REQUESTS,
  COINBASE_RATE_LIMIT_WINDOW_MS,
  COINBASE_RATE_LIMIT_IP_TTL_MS,
} from '../constants/rate-limits.js';

const router = express.Router();

// --- In-memory price cache (5s TTL) ---
const priceCache = new Map(); // symbol -> { data, timestamp }

// --- Per-IP rate limiter: max 10 requests / 10s ---
const ipHits = new Map(); // ip -> { hits: number[], lastSeenAt: number }

function cleanupExpiredIpHits(now) {
  for (const [ip, entry] of ipHits.entries()) {
    if (now - entry.lastSeenAt > COINBASE_RATE_LIMIT_IP_TTL_MS) {
      ipHits.delete(ip);
    }
  }
}

function isRateLimited(req, res) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  cleanupExpiredIpHits(now);

  const existing = ipHits.get(ip);
  const hits = (existing?.hits || []).filter((t) => now - t < COINBASE_RATE_LIMIT_WINDOW_MS);
  if (hits.length >= COINBASE_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((COINBASE_RATE_LIMIT_WINDOW_MS - (now - hits[0])) / 1000);
    res.set('Retry-After', String(Math.max(1, retryAfter)));
    return true;
  }
  hits.push(now);
  ipHits.set(ip, { hits, lastSeenAt: now });
  return false;
}

// --- Serial request queue: process Coinbase calls one at a time, 100ms apart ---
let queueChain = Promise.resolve();
function enqueue(task) {
  const run = queueChain.then(async () => {
    const result = await task();
    await new Promise((r) => setTimeout(r, 100));
    return result;
  });
  // keep chain alive regardless of individual task errors
  queueChain = run.catch(() => {});
  return run;
}

/**
 * GET /coinbase/price - Get real-time price for a symbol
 * Query params: symbol (e.g., 'BTC-USD')
 * Returns: { symbol, price, change24h, high24h, low24h, volume24h }
 */
router.get('/price', validateSymbolQuery, async (req, res) => {
  if (res.headersSent) return;

  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'symbol query parameter is required' });
  }
  if (typeof symbol !== 'string' || symbol.length > 20) {
    return res.status(400).json({ error: 'symbol must be a string with max length 20' });
  }

  // Serve fresh cached price without hitting rate limit or Coinbase
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  // Apply per-IP rate limiting only for cache misses
  if (isRateLimited(req, res)) {
    // If we have any stale cached value, return it instead of erroring
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true });
    }
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }

  try {
    // Fetch product data through the serial queue
    const product = await enqueue(() => coinbase.getProduct(symbol));

    if (!product) {
      throw new Error(`Failed to fetch product data for ${symbol}`);
    }

    const price = parseFloat(product.price);

    // Fetch 24h candles to calculate 24h stats
    const candles = await coinbase.getCandles(symbol, 3600, 24); // 1 hour granularity, 24 candles

    let change24h = 0;
    let high24h = price;
    let low24h = price;
    let volume24h = 0;

    if (candles && candles.length > 0) {
      const openPrice = parseFloat(candles[0].open);
      change24h = parseFloat(((price - openPrice) / openPrice * 100).toFixed(2));

      // Calculate 24h high, low, and volume
      high24h = Math.max(...candles.map(c => parseFloat(c.high)));
      low24h = Math.min(...candles.map(c => parseFloat(c.low)));
      volume24h = candles.reduce((sum, c) => sum + parseFloat(c.volume), 0);
    }

    const payload = {
      symbol,
      price: parseFloat(price.toFixed(2)),
      change24h,
      high24h: parseFloat(high24h.toFixed(2)),
      low24h: parseFloat(low24h.toFixed(2)),
      volume24h: parseFloat(volume24h.toFixed(2)),
    };

    priceCache.set(symbol, { data: payload, timestamp: Date.now() });
    return res.json(payload);
  } catch (error) {
    if (res.headersSent) return;

    // If we have a stale cached value, prefer it over mock data
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true });
    }

    const payload = {
      symbol,
      price: 45000.00,
      change24h: 2.5,
      high24h: 46000.00,
      low24h: 44000.00,
      volume24h: 1500000.00,
      mock: true,
    };
    priceCache.set(symbol, { data: payload, timestamp: Date.now() });
    return res.json(payload);
  }
});

/**
 * GET /coinbase/balance - Get account balance from Coinbase
 * Returns: { totalUSD, availableUSDC, assets: [{symbol, amount, value}] }
 */
router.get('/balance', async (req, res) => {
  if (res.headersSent) return;
  try {
    logger.info('Fetching Coinbase account balance');

    const accounts = await coinbase.getAllAccounts();

    if (!accounts || accounts.length === 0) {
      throw new Error('Failed to fetch accounts from Coinbase API');
    }

    let totalUSD = 0;
    let availableUSDC = 0;
    const assets = [];

    for (const account of accounts) {
      const balance = parseFloat(account.balance);
      const available = parseFloat(account.available);
      const currency = account.currency;

      if (balance <= 0) continue;

      if (currency === 'USD') {
        totalUSD += balance;
        availableUSDC += available;
      } else if (currency === 'USDC') {
        totalUSD += balance;
        availableUSDC += available;
      } else {
        // Fetch current price for crypto asset
        const productId = `${currency}-USD`;
        const product = await coinbase.getProduct(productId);
        const price = parseFloat(product.price);
        const value = balance * price;

        totalUSD += value;
        assets.push({
          symbol: currency,
          amount: parseFloat(balance.toFixed(8)),
          value: parseFloat(value.toFixed(2)),
          price: parseFloat(price.toFixed(2)),
        });
      }
    }

    logger.info(`Balance fetched: Total USD: $${totalUSD.toFixed(2)}, Assets: ${assets.length}`);

    return res.json({
      totalUSD: parseFloat(totalUSD.toFixed(2)),
      availableUSDC: parseFloat(availableUSDC.toFixed(2)),
      assets,
    });
  } catch (error) {
    if (res.headersSent) return;

    logger.error('Failed to fetch balance:', error.message);

    // Return mock wallet data on error
    logger.info('Returning mock wallet data');
    return res.json({
      totalUSD: 10000.00,
      availableUSDC: 5000.00,
      assets: [
        { symbol: 'BTC', amount: 0.5, value: 22500.00, price: 45000.00 },
        { symbol: 'ETH', amount: 5.0, value: 10000.00, price: 2000.00 },
      ],
      mock: true,
    });
  }
});

function optionalAuth(req, res, next) {
  if (!req.headers.authorization) {
    return next();
  }

  return authMiddleware(req, res, next);
}

/**
 * GET /coinbase/fills - Get live fills / filled orders with PocketBase fallback.
 * Query params: limit
 */
router.get('/fills', optionalAuth, async (req, res) => {
  if (res.headersSent) return;

  const limit = Number(req.query.limit || 50);

  try {
    const payload = await getCoinbaseFillHistory({ limit, userId: req.user?.id || null });
    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    logger.error('Failed to fetch Coinbase fills:', error.message);
    return res.json({
      success: true,
      source: 'mock',
      live: false,
      updatedAt: new Date().toISOString(),
      records: [],
    });
  }
});

export default router;