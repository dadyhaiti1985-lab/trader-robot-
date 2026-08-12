import { isPocketbaseReachable } from '../utils/pbClient.js';

async function checkCoinbase() {
	try {
		const response = await fetch('https://api.coinbase.com/v2/time', { method: 'GET' });
		return {
			status: response.ok ? 'up' : 'down',
			httpStatus: response.status,
		};
	} catch (error) {
		return { status: 'down', error: error?.message || String(error) };
	}
}

async function checkSupabase() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
		return { status: 'not_configured' };
	}

	try {
		const endpoint = `${String(process.env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/`;
		const response = await fetch(endpoint, {
			method: 'GET',
			headers: { apikey: process.env.SUPABASE_KEY },
		});
		return {
			status: response.status < 500 ? 'up' : 'down',
			httpStatus: response.status,
		};
	} catch (error) {
		return { status: 'down', error: error?.message || String(error) };
	}
}

async function checkRedis() {
	if (!process.env.REDIS_URL) {
		return { status: 'not_configured' };
	}

	return { status: 'not_checked' };
}

export default async (_req, res) => {
	const [pocketbaseReachable, coinbase, supabase, redis] = await Promise.all([
		isPocketbaseReachable(),
		checkCoinbase(),
		checkSupabase(),
		checkRedis(),
	]);

	const pocketbase = { status: pocketbaseReachable ? 'up' : 'down' };
	const dependencies = { pocketbase, coinbase, supabase, redis };
	const hasFailure = Object.values(dependencies).some((entry) => entry.status === 'down');

	return res.status(hasFailure ? 503 : 200).json({
		status: hasFailure ? 'degraded' : 'ok',
		timestamp: new Date().toISOString(),
		dependencies,
	});
};
