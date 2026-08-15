import crypto from 'node:crypto';
import { buildCoinbaseHeaders } from '../utils/coinbase-auth.js';
import logger from '../utils/logger.js';
import pb from '../utils/pbClient.js';
import { ORDER_STATES, updateOrderStatus } from './order-manager.js';

const LOOP_INTERVAL_MS = 5_000;
const HYDRATE_INTERVAL_MS = 30_000;
const BREAK_EVEN_REASON = 'Break-even triggered';
const TRAILING_REASON = 'Trailing stop updated';
const COINBASE_CIRCUIT_BREAKER_THRESHOLD = 3;
const COINBASE_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const registry = new Map();

let loopTimer = null;
let hydrateAt = 0;
let coinbaseFailureCount = 0;
let coinbaseCircuitOpenUntil = 0;

function isCoinbaseCircuitOpen() {
	return coinbaseCircuitOpenUntil > Date.now();
}

function recordCoinbaseFailure() {
	coinbaseFailureCount += 1;
	if (coinbaseFailureCount >= COINBASE_CIRCUIT_BREAKER_THRESHOLD) {
		coinbaseCircuitOpenUntil = Date.now() + COINBASE_CIRCUIT_BREAKER_COOLDOWN_MS;
		logger.warn(`[PositionGuard] Coinbase circuit opened for ${COINBASE_CIRCUIT_BREAKER_COOLDOWN_MS}ms after ${coinbaseFailureCount} failures`);
		coinbaseFailureCount = 0;
	}
}

function recordCoinbaseSuccess() {
	coinbaseFailureCount = 0;
	coinbaseCircuitOpenUntil = 0;
}

function getEncryptionKey() {
	const secret = process.env.ORACLE_CREDENTIALS_ENCRYPTION_KEY;
	if (!secret) {
		throw new Error('ORACLE_CREDENTIALS_ENCRYPTION_KEY is not set');
	}
	return crypto.createHash('sha256').update(secret).digest();
}

function decryptSecret(cipherBlob) {
	if (!cipherBlob) return null;
	const key = getEncryptionKey();
	const raw = Buffer.from(cipherBlob, 'base64');
	const iv = raw.subarray(0, 12);
	const authTag = raw.subarray(12, 28);
	const encrypted = raw.subarray(28);
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function normalizeSide(value) {
	return String(value || '').toLowerCase() === 'sell' ? 'sell' : 'buy';
}

function buildDefaultProtectionPlan(position) {
	return {
		breakEvenTriggerPct: 1.5,
		breakEvenPrice: Number(position.entryPrice || 0),
		trailingActivationPct: 1.2,
		trailLockRatio: 0.5,
		mode: 'trend-follow',
		direction: normalizeSide(position.side),
	};
}

function ensurePositionState(position) {
	return {
		breakEvenTriggered: Boolean(position.breakEvenTriggered),
		trailingActivated: Boolean(position.trailingActivated),
		highestPrice: Number(position.highestPrice || position.entryPrice || 0),
		lowestPrice: Number(position.lowestPrice || position.entryPrice || 0),
		currentStopLoss: Number(position.currentStopLoss || position.stopLoss || 0),
		closed: Boolean(position.closed),
	};
}

export function evaluateProtectionStep(position, currentPrice) {
	const entryPrice = Number(position.entryPrice || 0);
	const side = normalizeSide(position.side);
	const protectionPlan = position.protectionPlan || buildDefaultProtectionPlan(position);
	const state = ensurePositionState(position);

	if (!(entryPrice > 0) || !(currentPrice > 0)) {
		return { updates: state, actions: [], currentPrice };
	}

	const favorableMovePct = side === 'buy'
		? ((currentPrice - entryPrice) / entryPrice) * 100
		: ((entryPrice - currentPrice) / entryPrice) * 100;

	state.highestPrice = Math.max(state.highestPrice, currentPrice);
	state.lowestPrice = state.lowestPrice === 0 ? currentPrice : Math.min(state.lowestPrice, currentPrice);

	const actions = [];

	let breakEvenActivatedThisStep = false;

	if (!state.breakEvenTriggered && favorableMovePct >= Number(protectionPlan.breakEvenTriggerPct || 1.5)) {
		state.breakEvenTriggered = true;
		state.currentStopLoss = Number(protectionPlan.breakEvenPrice || entryPrice);
		breakEvenActivatedThisStep = true;
		actions.push({ type: 'break-even', stopLoss: state.currentStopLoss, reason: BREAK_EVEN_REASON });
	}

	if (!breakEvenActivatedThisStep && favorableMovePct >= Number(protectionPlan.trailingActivationPct || 1.2)) {
		const referencePrice = side === 'buy' ? state.highestPrice : state.lowestPrice;
		const lockedDistance = Math.abs(referencePrice - entryPrice) * Number(protectionPlan.trailLockRatio || 0.5);
		const candidateStop = side === 'buy'
			? Number((entryPrice + lockedDistance).toFixed(8))
			: Number((entryPrice - lockedDistance).toFixed(8));

		const isImproved = side === 'buy'
			? candidateStop > state.currentStopLoss
			: state.currentStopLoss === 0 || candidateStop < state.currentStopLoss;

		if (isImproved) {
			state.trailingActivated = true;
			state.currentStopLoss = candidateStop;
			actions.push({ type: 'trailing-update', stopLoss: candidateStop, reason: TRAILING_REASON });
		}
	}

	const stopHit = side === 'buy'
		? currentPrice <= state.currentStopLoss
		: currentPrice >= state.currentStopLoss && state.currentStopLoss > 0;

	if (state.currentStopLoss > 0 && stopHit) {
		state.closed = true;
		actions.push({
			type: 'exit',
			stopLoss: state.currentStopLoss,
			reason: state.trailingActivated ? 'Trailing stop hit' : state.breakEvenTriggered ? 'Break-even stop hit' : 'Protective stop hit',
			exitPrice: currentPrice,
		});
	}

	return { updates: state, actions, currentPrice, favorableMovePct: Number(favorableMovePct.toFixed(2)) };
}

async function fetchSpotPrice(pair) {
	if (isCoinbaseCircuitOpen()) {
		throw new Error('Coinbase circuit breaker is open');
	}

	const symbol = String(pair || 'BTC-USD').replace('/', '-').toUpperCase();
	try {
		const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}/spot`, {
			method: 'GET',
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) {
			throw new Error(`spot price request failed: ${response.status}`);
		}
		const payload = await response.json();
		const amount = Number(payload?.data?.amount || 0);
		if (!(amount > 0)) {
			throw new Error(`invalid spot price for ${symbol}`);
		}
		recordCoinbaseSuccess();
		return amount;
	} catch (error) {
		recordCoinbaseFailure();
		throw error;
	}
}

async function loadUserCredentials(userId) {
	if (!userId) return null;
	try {
		const record = await pb.collection('oracle_credentials').getFirstListItem(`owner = "${userId}"`);
		const apiKey = decryptSecret(record.apiKeyCipher);
		const apiSecret = decryptSecret(record.apiSecretCipher);
		if (!apiKey || !apiSecret) return null;
		return { apiKey, apiSecret };
	} catch {
		return null;
	}
}

async function tryCloseOnCoinbase(position, exitPrice) {
	if (isCoinbaseCircuitOpen()) {
		return { closedLive: false, reason: 'Coinbase circuit breaker is open' };
	}

	const credentials = await loadUserCredentials(position.userId);
	if (!credentials) {
		return { closedLive: false, reason: 'No user Coinbase credentials for live close' };
	}

	const side = normalizeSide(position.side) === 'buy' ? 'SELL' : 'BUY';
	const body = JSON.stringify({
		product_id: position.pair,
		side,
		order_configuration: {
			market_market_ioc: {
				base_size: String(position.quantity || 0),
			},
		},
	});
	const path = '/api/v3/brokerage/orders';
	const headers = buildCoinbaseHeaders(credentials.apiKey, credentials.apiSecret, 'POST', path, body);

	try {
		const response = await fetch(`https://api.coinbase.com${path}`, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(10_000),
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			recordCoinbaseFailure();
			return { closedLive: false, reason: `Coinbase close rejected (${response.status})`, payload };
		}
		recordCoinbaseSuccess();
		return { closedLive: true, exitOrderId: payload?.order_id || payload?.success_response?.order_id || null, exitPrice };
	} catch (error) {
		recordCoinbaseFailure();
		return { closedLive: false, reason: error?.message || 'Coinbase close failed' };
	}
}

function buildRegistryEntry({ userId, order, protectionPlan }) {
	return {
		userId,
		orderId: order.id,
		pair: String(order.pair || '').toUpperCase(),
		side: normalizeSide(order.side),
		quantity: Number(order.quantity || 0),
		entryPrice: Number(order.entryPrice || order.price || 0),
		stopLoss: Number(order.stopLoss || 0),
		takeProfit: Number(order.takeProfit || 0),
		protectionPlan: protectionPlan || buildDefaultProtectionPlan(order),
		breakEvenTriggered: false,
		trailingActivated: false,
		highestPrice: Number(order.entryPrice || order.price || 0),
		lowestPrice: Number(order.entryPrice || order.price || 0),
		currentStopLoss: Number(order.stopLoss || 0),
		closed: false,
	};
}

export function registerProtectedPosition({ userId, order, protectionPlan }) {
	if (!order?.id || !order?.pair) {
		return null;
	}

	const entry = buildRegistryEntry({ userId, order, protectionPlan });
	registry.set(order.id, entry);
	logger.info(`[PositionGuard] Registered ${entry.pair} ${entry.side.toUpperCase()} order=${entry.orderId} breakEven@${entry.protectionPlan.breakEvenTriggerPct}% trail@${entry.protectionPlan.trailingActivationPct}%`);
	return entry;
}

async function hydrateOpenOrders() {
	if (Date.now() < hydrateAt) {
		return;
	}
	hydrateAt = Date.now() + HYDRATE_INTERVAL_MS;

	try {
		const orders = await pb.collection('bot_orders').getFullList({
			filter: 'status = "pending" || status = "open" || status = "partially_filled"',
			sort: '-created',
		});

		for (const order of orders) {
			if (!registry.has(order.id)) {
				registry.set(order.id, buildRegistryEntry({ userId: order.userId, order, protectionPlan: buildDefaultProtectionPlan(order) }));
			}
		}
	} catch (error) {
		logger.warn('[PositionGuard] hydrate failed:', error?.message || error);
	}
}

async function applyOrderUpdate(orderId, state) {
	await updateOrderStatus(orderId, ORDER_STATES.OPEN, {
		stopLoss: state.currentStopLoss,
		takeProfit: state.takeProfit,
	});
}

async function closeProtectedPosition(position, action) {
	const liveClose = await tryCloseOnCoinbase(position, action.exitPrice);
	await updateOrderStatus(position.orderId, ORDER_STATES.FILLED, {
		stopLoss: position.currentStopLoss,
		takeProfit: position.takeProfit,
	});
	registry.delete(position.orderId);
	logger.info(`[PositionGuard] Exit executed for ${position.pair} order=${position.orderId} reason=${action.reason} price=${action.exitPrice}${liveClose.closedLive ? ` exitOrder=${liveClose.exitOrderId || 'n/a'}` : ` localClose=${liveClose.reason}`}`);
}

async function monitorRegistry() {
	await hydrateOpenOrders();
	for (const [orderId, position] of registry.entries()) {
		try {
			const currentPrice = await fetchSpotPrice(position.pair);
			const result = evaluateProtectionStep(position, currentPrice);
			Object.assign(position, result.updates);

			for (const action of result.actions) {
				if (action.type === 'break-even') {
					await applyOrderUpdate(orderId, position);
					logger.info(`[PositionGuard] Entry -> Break-Even Triggered for ${position.pair} order=${orderId} stop=${action.stopLoss}`);
				}
				if (action.type === 'trailing-update') {
					await applyOrderUpdate(orderId, position);
					logger.info(`[PositionGuard] Break-Even -> Trailing Stop Updated for ${position.pair} order=${orderId} stop=${action.stopLoss}`);
				}
				if (action.type === 'exit') {
					await closeProtectedPosition(position, action);
					break;
				}
			}
		} catch (error) {
			logger.warn(`[PositionGuard] monitor failed for order ${orderId}: ${error?.message || error}`);
		}
	}
}

export function startPositionGuardLoop() {
	if (loopTimer) {
		return loopTimer;
	}

	loopTimer = setInterval(() => {
		monitorRegistry().catch((error) => {
			logger.warn('[PositionGuard] loop error:', error?.message || error);
		});
	}, LOOP_INTERVAL_MS);

	logger.info(`[PositionGuard] Live position guard loop started (${LOOP_INTERVAL_MS}ms interval)`);
	return loopTimer;
}

export function stopPositionGuardLoop() {
	if (loopTimer) {
		clearInterval(loopTimer);
		loopTimer = null;
	}
	registry.clear();
}
