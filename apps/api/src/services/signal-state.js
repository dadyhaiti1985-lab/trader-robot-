/**
 * Signal State Manager
 * Tracks per-pair signal processing state to prevent duplicate execution
 */
import logger from '../utils/logger.js';
import { SIGNAL_STATE_TTL_MS } from '../constants/rate-limits.js';

const signalStates = new Map();
const CLEANUP_INTERVAL_MS = 60 * 1000;

function now() {
  return Date.now();
}

function touchState(state) {
  state.lastAccessedAt = now();
  return state;
}

function cleanupExpiredSignalStates() {
  const expiryCutoff = now() - SIGNAL_STATE_TTL_MS;
  for (const [key, state] of signalStates.entries()) {
    if ((state.lastAccessedAt || 0) < expiryCutoff) {
      signalStates.delete(key);
    }
  }
}

const cleanupTimer = setInterval(cleanupExpiredSignalStates, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

export function initializeSignalState(userId, pair) {
  const key = `${userId}:${pair}`;
  if (!signalStates.has(key)) {
    signalStates.set(key, {
      userId,
      pair,
      lastSignal: null,
      lastSignalTime: null,
      signalProcessed: false,
      lastCandleTime: null,
      lastAccessedAt: now(),
    });
  }
  return touchState(signalStates.get(key));
}

export function getSignalState(userId, pair) {
  const key = `${userId}:${pair}`;
  if (!signalStates.has(key)) {
    return initializeSignalState(userId, pair);
  }
  return touchState(signalStates.get(key));
}

export function updateSignalState(userId, pair, updates) {
  const state = initializeSignalState(userId, pair);
  Object.assign(state, updates);
  touchState(state);
  signalStates.set(`${userId}:${pair}`, state);
  return state;
}

// Returns true if this is a NEW candle (new signal should be processed)
export function isNewSignal(userId, pair, currentCandleTime) {
  const state = getSignalState(userId, pair);
  if (state.lastCandleTime !== currentCandleTime) {
    logger.info(`[SignalState] New candle for ${pair}: ${currentCandleTime}`);
    return true;
  }
  logger.info(`[SignalState] Same candle for ${pair} — signal already processed`);
  return false;
}

export function markSignalProcessed(userId, pair, candleTime) {
  updateSignalState(userId, pair, {
    signalProcessed: true,
    lastSignalTime: Date.now(),
    lastCandleTime: candleTime,
  });
}

export function resetSignalState(userId, pair, newCandleTime) {
  updateSignalState(userId, pair, {
    lastSignal: null,
    signalProcessed: false,
    lastCandleTime: newCandleTime,
  });
}

export function clearAllSignalStates() {
  signalStates.clear();
  logger.info('[SignalState] All signal states cleared');
}

export function getAllSignalStates() {
  return Array.from(signalStates.entries()).map(([key, state]) => ({ key, ...state }));
}
