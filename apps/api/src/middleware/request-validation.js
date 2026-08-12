import logger from '../utils/logger.js';

const MAX_JSON_DEPTH = 8;
const MAX_CONTENT_LENGTH_BYTES = 20 * 1024 * 1024;
const MAX_SYMBOL_LENGTH = 20;

function getDepth(value, depth = 0) {
	if (value == null || typeof value !== 'object') {
		return depth;
	}
	if (Array.isArray(value)) {
		return value.reduce((maxDepth, entry) => Math.max(maxDepth, getDepth(entry, depth + 1)), depth + 1);
	}
	return Object.values(value).reduce((maxDepth, entry) => Math.max(maxDepth, getDepth(entry, depth + 1)), depth + 1);
}

/**
 * Blocks overly nested JSON payloads and oversized request bodies.
 */
export function requestValidationMiddleware(req, res, next) {
	const contentLength = Number(req.headers['content-length'] || 0);
	if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
		return res.status(413).json({ error: 'Request payload too large' });
	}

	if (!req.is?.('multipart/form-data')) {
		const depth = getDepth(req.body);
		if (depth > MAX_JSON_DEPTH) {
			logger.warn(`[validation] blocked deep JSON payload depth=${depth} path=${req.originalUrl}`);
			return res.status(400).json({ error: `JSON body exceeds maximum depth of ${MAX_JSON_DEPTH}` });
		}
	}

	return next();
}

/**
 * Validates market symbol format and maximum length.
 */
export function validateSymbolQuery(req, res, next) {
	const symbol = req.query?.symbol;
	if (symbol === undefined) {
		return next();
	}

	if (typeof symbol !== 'string' || symbol.trim().length === 0 || symbol.length > MAX_SYMBOL_LENGTH || !/^[A-Za-z0-9/-]+$/.test(symbol)) {
		return res.status(400).json({ error: `symbol must be an alphanumeric market pair (max ${MAX_SYMBOL_LENGTH} chars)` });
	}

	return next();
}

export { MAX_JSON_DEPTH, MAX_CONTENT_LENGTH_BYTES, MAX_SYMBOL_LENGTH };
