import logger from '../utils/logger.js';
import { EXTERNAL_REQUEST_TIMEOUT_MS } from '../constants/rate-limits.js';

const FETCH_TIMEOUT_MARK = Symbol.for('api.fetch-timeout-installed');

/**
 * Installs a global fetch wrapper that adds a default timeout when no signal is provided.
 */
export function installGlobalFetchTimeout(timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS) {
	if (globalThis.fetch?.[FETCH_TIMEOUT_MARK]) {
		return;
	}

	const originalFetch = globalThis.fetch?.bind(globalThis);
	if (!originalFetch) {
		return;
	}

	const wrappedFetch = async (input, init = {}) => {
		if (init.signal) {
			return originalFetch(input, init);
		}

		return originalFetch(input, {
			...init,
			signal: AbortSignal.timeout(timeoutMs),
		});
	};

	wrappedFetch[FETCH_TIMEOUT_MARK] = true;
	globalThis.fetch = wrappedFetch;
	logger.info(`[timeout] Global fetch timeout enabled (${timeoutMs}ms)`);
}

/**
 * Ensures API requests do not hang forever waiting for upstream services.
 */
export function requestTimeoutMiddleware(timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS) {
	return (req, res, next) => {
		res.setTimeout(timeoutMs, () => {
			if (res.headersSent) {
				return;
			}
			logger.warn(`[timeout] ${req.method} ${req.originalUrl} exceeded ${timeoutMs}ms`);
			res.status(504).json({ error: 'Request timed out' });
		});
		next();
	};
}

export default requestTimeoutMiddleware;
