/*
 * PROPRIETARY INTELLECTUAL PROPERTY NOTICE
 * ORACLE TRADER PRO / DADY DESTIN — ALL RIGHTS RESERVED.
 * Unauthorized deployment, copying, or execution is prohibited.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'node:crypto';

import routes from './routes/index.js';
import { errorMiddleware } from './middleware/error.js';
import { globalRateLimit } from './middleware/global-rate-limit.js';
import { securityShield } from './middleware/security-shield.js';
import logger from './utils/logger.js';
import securityHeaders from './middleware/security-headers.js';
import { BodyLimit, NodeEnv } from './constants/common.js';
import { initializeBotService } from './services/botTradingService.js';
import { startPositionGuardLoop } from './services/live-position-guard.js';
import { runLicenseGuardStartupCheck } from './middleware/license-guard.js';
import { scheduleIntegrityMonitor } from './utils/integrity-monitor.js';
import { requestTimeoutMiddleware, installGlobalFetchTimeout } from './middleware/request-timeout.js';
import { requestValidationMiddleware } from './middleware/request-validation.js';
import runStartupChecks from './utils/startup-checks.js';

await runLicenseGuardStartupCheck();
const startupSummary = await runStartupChecks();

const app = express();
installGlobalFetchTimeout();

app.set('trust proxy', true);
app.disable('x-powered-by');

// Log environment on startup
logger.info('=== Backend Server Startup ===');
logger.info(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
logger.info(`PORT: ${process.env.PORT || 3001}`);
logger.info(`POCKETBASE_URL: ${process.env.POCKETBASE_URL || 'http://localhost:8090'}`);
if (process.env.NODE_ENV !== NodeEnv.Production) {
	logger.info(`COINBASE_API_KEY: ${process.env.COINBASE_API_KEY ? 'SET' : 'NOT SET'}`);
	logger.info(`COINBASE_API_SECRET: ${process.env.COINBASE_API_SECRET ? 'SET' : 'NOT SET'}`);
	logger.info(`COINBASE_API_PASSPHRASE: ${process.env.COINBASE_API_PASSPHRASE ? 'SET' : 'NOT SET'}`);
	logger.info(`PB_SUPERUSER_EMAIL: ${process.env.PB_SUPERUSER_EMAIL ? 'SET' : 'NOT SET'}`);
	logger.info(`PB_SUPERUSER_PASSWORD: ${process.env.PB_SUPERUSER_PASSWORD ? 'SET' : 'NOT SET'}`);
}
logger.info('==============================');

process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
});
  
process.on('unhandledRejection', (reason, promise) => {
	logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', async () => {
	logger.info('Interrupted');
	process.exit(0);
});

process.on('SIGTERM', async () => {
	logger.info('SIGTERM signal received');

	await new Promise(resolve => setTimeout(resolve, 3000));

	logger.info('Exiting');
	process.exit();
});

app.use(helmet());
app.use(securityHeaders);

// CORS Configuration
// Allow requests from specified frontend origins with credentials
const allowedOrigins = [
	'https://oracletraderpro.com',
	'https://www.oracletraderpro.com',
	'https://horizons.hostinger.com',
	'https://ede840c3-0d3d-4366-881e-753bec5b7927.app-preview.com',
	'http://localhost:5173',
	'http://localhost:3000',
	// Allow Railway preview URLs automatically via env
	...(process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : []),
];

app.use(cors({
	origin: (origin, callback) => {
		// Allow requests with no origin (like mobile apps or curl requests)
		if (!origin) {
			return callback(null, true);
		}

		// Check if origin is in allowed list
		if (allowedOrigins.includes(origin)) {
			return callback(null, true);
		}

		// Allow wildcard if CORS_ORIGIN env var is set to '*'
		if (process.env.CORS_ORIGIN === '*') {
			return callback(null, true);
		}

		// Reject origin not in allowed list
		logger.warn(`CORS request rejected from origin: ${origin}`);
		return callback(new Error('CORS policy: Origin not allowed'), false);
	},
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
	exposedHeaders: ['Content-Length', 'X-JSON-Response-Count'],
	maxAge: 86400, // 24 hours
}));

app.use(morgan('combined'));
app.use((req, res, next) => {
	const clientRequestId = Array.isArray(req.headers['x-correlation-id'])
		? req.headers['x-correlation-id'][0]
		: req.headers['x-correlation-id'];
	const safeClientRequestId = typeof clientRequestId === 'string'
		&& clientRequestId.length <= 128
		&& /^[A-Za-z0-9._-]+$/.test(clientRequestId)
		? clientRequestId
		: null;
	req.correlationId = crypto.randomUUID();
	req.clientCorrelationId = safeClientRequestId;
	res.setHeader('X-Correlation-Id', req.correlationId);
	const startedAt = Date.now();
	res.on('finish', () => {
		logger.info(`[request] ${req.correlationId} ${req.method} ${req.originalUrl} status=${res.statusCode} latencyMs=${Date.now() - startedAt}${safeClientRequestId ? ` clientId=${safeClientRequestId}` : ''}`);
	});
	next();
});
app.use(globalRateLimit);
app.use(requestTimeoutMiddleware());
app.use(express.json({
	limit: BodyLimit,
	// Save raw body for webhook signature verification
	verify: (req, _res, buf) => {
		req.rawBody = buf;
	},
}));
app.use(express.urlencoded({ 
	extended: true,
	limit: BodyLimit,
}));
app.use(requestValidationMiddleware);

app.use(securityShield);

app.use('/', routes());

app.use(errorMiddleware);

app.use((req, res) => {
	res.status(404).json({ error: 'Route not found' });
});

const port = process.env.PORT || 3001;

app.listen(port, () => {
	logger.info(`🚀 API Server running on http://localhost:${port}`);
	logger.info(`✅ CORS enabled for origins: ${allowedOrigins.join(', ')}`);
	logger.info(`[startup] dependency summary: ${JSON.stringify(startupSummary)}`);

	scheduleIntegrityMonitor({
		files: [
			'src/main.js',
			'src/routes/index.js',
			'src/routes/integrated-ai.js',
			'src/constants/prompts.js',
			'src/middleware/security-shield.js',
			'src/routes/webhooks.js',
			'src/utils/integrity-monitor.js',
		],
	});

	// Initialize bot trading service
	scheduleIntegrityMonitor({
		files: [
			'src/main.js',
			'src/routes/index.js',
			'src/routes/integrated-ai.js',
			'src/constants/prompts.js',
			'src/middleware/security-shield.js',
			'src/routes/webhooks.js',
		],
		healthChecks: [
			`http://127.0.0.1:${port}/health`,
			`${process.env.POCKETBASE_URL || 'http://localhost:8090'}/api/health`,
		],
	});
	initializeBotService().catch(err => {
		logger.error('Failed to initialize bot trading service:', err.message);
	});
	startPositionGuardLoop();
});

export default app;