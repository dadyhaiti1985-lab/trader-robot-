import logger from './logger.js';
import { validateCoinbaseFillsConfig } from '../services/coinbase-fills.js';
import { isPocketbaseReachable } from './pbClient.js';

const POCKETBASE_RETRY_ATTEMPTS = 3;
const POCKETBASE_RETRY_DELAY_MS = 1000;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPocketBaseWithRetry() {
	for (let attempt = 1; attempt <= POCKETBASE_RETRY_ATTEMPTS; attempt += 1) {
		const reachable = await isPocketbaseReachable();
		if (reachable) {
			return { reachable: true, attempts: attempt };
		}
		if (attempt < POCKETBASE_RETRY_ATTEMPTS) {
			await sleep(POCKETBASE_RETRY_DELAY_MS);
		}
	}

	return { reachable: false, attempts: POCKETBASE_RETRY_ATTEMPTS };
}

async function checkCoinbaseReachable() {
	try {
		const response = await fetch('https://api.coinbase.com/v2/time', { method: 'GET' });
		return { reachable: response.ok, status: response.status };
	} catch (error) {
		return { reachable: false, error: error?.message || String(error) };
	}
}

async function checkSupabaseReachable() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
		return { configured: false, reachable: false };
	}

	try {
		const endpoint = `${String(process.env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/`;
		const response = await fetch(endpoint, {
			method: 'GET',
			headers: {
				apikey: process.env.SUPABASE_KEY,
			},
		});
		return { configured: true, reachable: response.status < 500, status: response.status };
	} catch (error) {
		return { configured: true, reachable: false, error: error?.message || String(error) };
	}
}

/**
 * Validates required configuration and probes dependency reachability before startup.
 */
export async function runStartupChecks() {
	validateCoinbaseFillsConfig();

	const pocketBase = await checkPocketBaseWithRetry();
	const coinbase = await checkCoinbaseReachable();
	const supabase = await checkSupabaseReachable();
	const redisConfigured = Boolean(process.env.REDIS_URL);

	const summary = {
		pocketBase,
		coinbase,
		supabase,
		redis: {
			configured: redisConfigured,
			status: redisConfigured ? 'not-checked' : 'not-configured',
		},
	};

	if (!pocketBase.reachable) {
		logger.warn(`[startup] PocketBase unreachable after ${pocketBase.attempts} attempts. Starting in degraded mode.`);
	}
	if (!coinbase.reachable) {
		logger.warn('[startup] Coinbase health probe failed. API will use fallback behavior where available.');
	}
	if (supabase.configured && !supabase.reachable) {
		logger.warn('[startup] Supabase configured but currently unreachable.');
	}

	logger.info('[startup] Startup validation complete', {
		nodeEnv: process.env.NODE_ENV || 'development',
		port: process.env.PORT || 3001,
		hasPocketBaseUrl: Boolean(process.env.POCKETBASE_URL),
		hasCoinbaseApiKey: Boolean(process.env.COINBASE_API_KEY),
		hasCoinbaseApiSecret: Boolean(process.env.COINBASE_API_SECRET),
		hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
		hasSupabaseKey: Boolean(process.env.SUPABASE_KEY),
		hasRedisUrl: redisConfigured,
	});

	return summary;
}

export default runStartupChecks;
