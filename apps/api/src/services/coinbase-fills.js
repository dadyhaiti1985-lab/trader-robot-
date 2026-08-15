import crypto from 'node:crypto';
import { buildCoinbaseHeaders } from '../utils/coinbase-auth.js';
import pb from '../utils/pbClient.js';
import logger from '../utils/logger.js';

const COINBASE_FILLS_PATH = '/api/v3/brokerage/orders/historical/fills';
const DEFAULT_LIMIT = 50;

/**
 * Ensures encrypted credential support is configured before runtime.
 */
export function validateCoinbaseFillsConfig() {
	if (!process.env.ORACLE_CREDENTIALS_ENCRYPTION_KEY) {
		throw new Error('ORACLE_CREDENTIALS_ENCRYPTION_KEY is required to decrypt stored Coinbase credentials');
	}
}

function getEncryptionKey() {
	const secret = process.env.ORACLE_CREDENTIALS_ENCRYPTION_KEY;
	if (!secret) {
		throw new Error('ORACLE_CREDENTIALS_ENCRYPTION_KEY is not set');
	}

	return crypto.createHash('sha256').update(secret).digest();
}

function decryptSecret(cipherBlob) {
	if (!cipherBlob) {
		return null;
	}

	const key = getEncryptionKey();
	const raw = Buffer.from(cipherBlob, 'base64');
	const iv = raw.subarray(0, 12);
	const authTag = raw.subarray(12, 28);
	const encrypted = raw.subarray(28);
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function getUserCoinbaseCredentials(userId) {
	if (!userId) {
		return null;
	}

	try {
		const record = await pb.collection('oracle_credentials').getFirstListItem(`owner = "${userId}"`);
		const apiKey = decryptSecret(record.apiKeyCipher);
		const apiSecret = decryptSecret(record.apiSecretCipher);

		if (!apiKey || !apiSecret) {
			return null;
		}

		return { apiKey, apiSecret, source: 'pocketbase' };
	} catch (error) {
		logger.debug('[coinbase-fills] No per-user Coinbase credentials available:', error?.message || error);
		return null;
	}
}

async function resolveCoinbaseCredentials(userId) {
	const userCredentials = await getUserCoinbaseCredentials(userId);
	if (userCredentials) {
		return userCredentials;
	}

	if (process.env.COINBASE_API_KEY && process.env.COINBASE_API_SECRET) {
		return {
			apiKey: process.env.COINBASE_API_KEY,
			apiSecret: process.env.COINBASE_API_SECRET,
			source: 'env',
		};
	}

	return null;
}

function clampLimit(limit) {
	const value = Number.parseInt(String(limit ?? DEFAULT_LIMIT), 10);
	return Number.isFinite(value) ? Math.min(Math.max(value, 1), 200) : DEFAULT_LIMIT;
}

function normalizePair(value) {
	return String(value || '').trim().toUpperCase();
}

function getBaseAsset(instrument) {
	const pair = normalizePair(instrument);
	return pair.includes('-') ? pair.split('-')[0] : pair.split('/')[0] || pair || 'BTC';
}

function formatNumber(value, fractionDigits = 8) {
	const numericValue = Number.parseFloat(String(value ?? 0).replace(/,/g, '.'));
	if (!Number.isFinite(numericValue)) {
		return '0';
	}

	return new Intl.NumberFormat('fr-FR', {
		minimumFractionDigits: 0,
		maximumFractionDigits: fractionDigits,
	}).format(numericValue);
}

function formatMoney(value) {
	const numericValue = Number.parseFloat(String(value ?? 0).replace(/,/g, '.'));
	if (!Number.isFinite(numericValue)) {
		return '0,00 $US';
	}

	return `${new Intl.NumberFormat('fr-FR', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(numericValue)} $US`;
}

function formatExecutionTime(value) {
	const date = new Date(value || Date.now());
	const day = String(date.getDate());
	const month = String(date.getMonth() + 1);
	const year = String(date.getFullYear()).slice(-2);
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

function normalizeSide(value) {
	return String(value || 'BUY').trim().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

function normalizeType(value) {
	const type = String(value || 'market').trim().toLowerCase();
	if (type.includes('limit')) return 'Limit';
	if (type.includes('stop')) return 'Stop';
	if (type.includes('transfer')) return 'Transfer';
	return 'Market';
}

function makeOrderId(fill) {
	return String(fill?.order_id || fill?.orderId || fill?.trade_id || fill?.tradeId || fill?.id || fill?.uuid || '').trim();
}

function normalizeLiveFill(fill) {
	const instrument = normalizePair(fill?.product_id || fill?.instrument || fill?.symbol || fill?.market || '');
	const side = normalizeSide(fill?.side || fill?.order_side || fill?.orderSide);
	const baseAsset = getBaseAsset(instrument);
	const quantityValue = fill?.size_in_base ?? fill?.filled_size ?? fill?.size ?? fill?.quantity ?? fill?.base_size ?? fill?.amount ?? 0;
	const priceValue = fill?.price ?? fill?.average_filled_price ?? fill?.average_price ?? fill?.fill_price ?? fill?.execution_price ?? 0;
	const feeValue = fill?.commission ?? fill?.total_fees ?? fill?.fee ?? fill?.fees ?? 0;

	return {
		id: makeOrderId(fill) || `${instrument}-${Date.now()}`,
		executionTime: formatExecutionTime(fill?.trade_time || fill?.created_time || fill?.created_at || fill?.timestamp || fill?.filled_at),
		portfolio: String(fill?.portfolio || fill?.profile || fill?.account_name || fill?.account || fill?.wallet || 'Principal'),
		instrument: instrument || 'BTC-USD',
		orderId: makeOrderId(fill) || 'unknown',
		side,
		filledQuantity: `${formatNumber(quantityValue)} ${baseAsset}`.trim(),
		executionPrice: formatMoney(priceValue),
		fees: formatMoney(feeValue),
		type: normalizeType(fill?.order_type || fill?.type || fill?.order_configuration_type || fill?.liquidity_indicator),
		direction: side === 'SELL' ? 'Sell' : 'Buy',
		signalConfidence: String(fill?.signal_confidence || fill?.liquidity_indicator || (side === 'SELL' ? 'Medium' : 'High')),
		riskBadge: side === 'SELL' ? 'Distribution' : 'Accumulation',
		source: 'coinbase-live',
	};
}

function normalizePocketBaseOrder(order) {
	const instrument = normalizePair(order?.pair || order?.symbol || order?.market || 'BTC-USD');
	const side = normalizeSide(order?.side);
	const baseAsset = getBaseAsset(instrument);
	const quantityValue = order?.filledQuantity ?? order?.quantity ?? order?.size ?? 0;
	const priceValue = order?.executionPrice ?? order?.price ?? order?.average_filled_price ?? 0;
	const feeValue = order?.fees ?? order?.fee ?? order?.commission ?? 0;

	return {
		id: String(order?.externalOrderId || order?.id || order?.orderId || `${instrument}-${order?.created || Date.now()}`),
		executionTime: formatExecutionTime(order?.created || order?.updated || order?.timestamp),
		portfolio: String(order?.portfolio || order?.profile || order?.accountName || 'Principal'),
		instrument,
		orderId: String(order?.externalOrderId || order?.id || order?.orderId || 'unknown'),
		side,
		filledQuantity: `${formatNumber(quantityValue)} ${baseAsset}`.trim(),
		executionPrice: formatMoney(priceValue),
		fees: formatMoney(feeValue),
		type: normalizeType(order?.orderType || order?.type || order?.executionType || 'market'),
		direction: side === 'SELL' ? 'Sell' : 'Buy',
		signalConfidence: String(order?.confidence || order?.signalConfidence || (side === 'SELL' ? 'Medium' : 'High')),
		riskBadge: side === 'SELL' ? 'Distribution' : 'Accumulation',
		source: 'pocketbase',
	};
}

function dedupeByOrderId(rows) {
	const seen = new Set();
	return rows.filter((row) => {
		const key = `${row.orderId}-${row.executionTime}-${row.instrument}-${row.side}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function buildMockFills(limit) {
	const seed = [
		{ executionTime: '28/6/26 18:53:54', portfolio: 'DADY', instrument: 'BTC-USD', orderId: '7a5f2d4e-2b7a-4b3a-b6f1-8c3ad0e0a101', side: 'BUY', filledQuantity: '0,00011138 BTC', executionPrice: '58 908,98 $US', fees: '0,08 $US', type: 'Market', direction: 'Buy', signalConfidence: 'High', riskBadge: 'Accumulation', source: 'mock' },
		{ executionTime: '28/6/26 18:51:12', portfolio: 'Principal', instrument: 'DIA-USDC', orderId: 'b4d8fbe0-d6f1-43ea-8a8b-44c6f57f8c22', side: 'SELL', filledQuantity: '18,24000000 DIA', executionPrice: '4,218,10 $US', fees: '0,12 $US', type: 'Limit', direction: 'Sell', signalConfidence: 'Medium', riskBadge: 'Distribution', source: 'mock' },
		{ executionTime: '28/6/26 18:49:39', portfolio: 'DADY', instrument: 'AVNT-USD', orderId: '1cc2e3ae-7d48-4f7a-81a9-e0f42d3c1c33', side: 'BUY', filledQuantity: '352,00000000 AVNT', executionPrice: '0,93 $US', fees: '0,05 $US', type: 'Market', direction: 'Buy', signalConfidence: 'High', riskBadge: 'Accumulation', source: 'mock' },
		{ executionTime: '28/6/26 18:46:02', portfolio: 'Principal', instrument: 'ETH-USD', orderId: '0d9d1cb2-1f76-47a8-b9f4-3f44e2f90344', side: 'BUY', filledQuantity: '0,81000000 ETH', executionPrice: '3 205,77 $US', fees: '0,09 $US', type: 'Market', direction: 'Buy', signalConfidence: 'High', riskBadge: 'Accumulation', source: 'mock' },
		{ executionTime: '28/6/26 18:41:18', portfolio: 'DADY', instrument: 'SOL-USD', orderId: 'c2c0fd97-5a1a-4c0d-bf6b-7cefd84f3155', side: 'SELL', filledQuantity: '15,50000000 SOL', executionPrice: '184,12 $US', fees: '0,03 $US', type: 'Limit', direction: 'Sell', signalConfidence: 'Medium', riskBadge: 'Distribution', source: 'mock' },
		{ executionTime: '28/6/26 18:39:02', portfolio: 'Principal', instrument: 'BTC-USD', orderId: 'd3b62fa6-6b2a-4c4f-9f2c-4c5bb1cf6606', side: 'BUY', filledQuantity: '0,00170450 BTC', executionPrice: '58 644,31 $US', fees: '0,11 $US', type: 'Limit', direction: 'Buy', signalConfidence: 'High', riskBadge: 'Accumulation', source: 'mock' },
		{ executionTime: '28/6/26 18:36:47', portfolio: 'Principal', instrument: 'ETH-USD', orderId: 'e35cc3f1-9f5c-4ad4-b594-08b719cbce77', side: 'SELL', filledQuantity: '1,42000000 ETH', executionPrice: '3 214,04 $US', fees: '0,06 $US', type: 'Transfer', direction: 'Sell', signalConfidence: 'Medium', riskBadge: 'Neutral', source: 'mock' },
		{ executionTime: '28/6/26 18:34:20', portfolio: 'DADY', instrument: 'SOL-USD', orderId: 'f84f7b8f-4d5d-4cc4-a2ce-bf9b7e0d8f88', side: 'BUY', filledQuantity: '42,00000000 SOL', executionPrice: '179,75 $US', fees: '0,04 $US', type: 'Market', direction: 'Buy', signalConfidence: 'High', riskBadge: 'Accumulation', source: 'mock' },
	];

	return seed.slice(0, limit).map((row) => ({ ...row }));
}

async function fetchLiveCoinbaseFills(limit, userId) {
	const credentials = await resolveCoinbaseCredentials(userId);
	if (!credentials?.apiKey || !credentials?.apiSecret) {
		return [];
	}

	const path = `${COINBASE_FILLS_PATH}?limit=${limit}`;
	const headers = buildCoinbaseHeaders(credentials.apiKey, credentials.apiSecret, 'GET', path);

	try {
		const response = await fetch(`https://api.coinbase.com${path}`, {
			method: 'GET',
			headers,
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			logger.warn(`[coinbase-fills] Coinbase returned ${response.status} for ${path}`);
			return [];
		}

		const payload = await response.json();
		const fills = Array.isArray(payload)
			? payload
			: payload?.fills || payload?.order_fills || payload?.data || payload?.transactions || [];

		return fills.map(normalizeLiveFill);
	} catch (error) {
		logger.warn('[coinbase-fills] Live Coinbase fills fetch failed:', error?.message || error);
		return [];
	}
}

async function fetchPocketBaseHistoricalFills(limit) {
	const rows = [];

	try {
		const orders = await pb.collection('bot_orders').getList(1, limit, {
			filter: 'status = "filled" || status = "partially_filled"',
			sort: '-created',
		});
		rows.push(...(orders.items || []).map(normalizePocketBaseOrder));
	} catch (error) {
		logger.warn('[coinbase-fills] PocketBase bot_orders fallback unavailable:', error?.message || error);
	}

	if (rows.length < limit) {
		try {
			const trades = await pb.collection('botTrades').getList(1, limit, {
				sort: '-timestamp',
			});
			rows.push(...(trades.items || []).map((trade) => normalizePocketBaseOrder({
				id: trade.id,
				externalOrderId: trade.orderId || trade.externalOrderId,
				pair: trade.symbol || trade.pair,
				side: trade.side,
				quantity: trade.quantity,
				price: trade.price || trade.entryPrice || trade.exitPrice,
				fees: trade.fees || trade.fee,
				orderType: trade.orderType || 'market',
				created: trade.timestamp || trade.created,
				profile: trade.profile || 'Principal',
				confidence: trade.confidence,
			})));
		} catch (error) {
			logger.warn('[coinbase-fills] PocketBase botTrades fallback unavailable:', error?.message || error);
		}
	}

	return dedupeByOrderId(rows).slice(0, limit);
}

export async function getCoinbaseFillHistory({ limit = DEFAULT_LIMIT, userId = null } = {}) {
	const safeLimit = clampLimit(limit);
	const liveRows = await fetchLiveCoinbaseFills(safeLimit, userId);

	if (liveRows.length > 0) {
		return {
			source: 'coinbase-live',
			live: true,
			updatedAt: new Date().toISOString(),
			records: liveRows.slice(0, safeLimit),
		};
	}

	const pocketBaseRows = await fetchPocketBaseHistoricalFills(safeLimit);
	if (pocketBaseRows.length > 0) {
		return {
			source: 'pocketbase',
			live: false,
			updatedAt: new Date().toISOString(),
			records: pocketBaseRows.slice(0, safeLimit),
		};
	}

	return {
		source: 'mock',
		live: false,
		updatedAt: new Date().toISOString(),
		records: buildMockFills(safeLimit),
	};
}
