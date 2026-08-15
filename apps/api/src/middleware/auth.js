import logger from '../utils/logger.js';

const POCKETBASE_URL = String(process.env.POCKETBASE_URL || 'http://localhost:8090').replace(/\/$/, '');

export default async function authMiddleware(req, res, next) {
	const header = req.headers.authorization;

	if (!header || !header.startsWith('Bearer ')) {
		return res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN' });
	}

	const token = header.slice('Bearer '.length).trim();

	let response;

	try {
		response = await fetch(`${POCKETBASE_URL}/api/collections/users/auth-refresh`, {
			method: 'POST',
			headers: { Authorization: token },
		});
	} catch (error) {
		// PocketBase unreachable — this is a service problem, not a bad token.
		logger.error(`[auth] PocketBase unreachable at ${POCKETBASE_URL} for ${req.method} ${req.originalUrl}:`, error?.message || error);
		return res.status(503).json({
			error: 'Authentication service unavailable. Please try again in a moment.',
			code: 'PB_UNAVAILABLE',
		});
	}

	if (!response.ok) {
		logger.warn(`[auth] token rejected (${response.status}) for ${req.method} ${req.originalUrl}`);
		return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'INVALID_TOKEN' });
	}

	const data = await response.json().catch(() => null);

	if (!data?.record?.id) {
		return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_TOKEN' });
	}

	req.user = { id: data.record.id, email: data.record.email };

	return next();
}
