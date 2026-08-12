# API Critical Fixes Summary

## Critical fixes

1. Added robust input validation and divide-by-zero guards in `/home/runner/work/trader-robot-/trader-robot-/apps/api/src/strategies/backtestEngine.js`.
2. Added startup-time encryption key validation via `validateCoinbaseFillsConfig()` and wired it into startup checks.
3. Added TTL cleanup for in-memory signal state (5-minute expiry for inactive states).
4. Replaced hardcoded PocketBase URL usage in middleware with `POCKETBASE_URL`.

## High-priority improvements

5. Added strategy route validation for maximum candle array size (5000) and numeric parameters.
6. Added TTL cleanup for Coinbase per-IP rate limiter entries (30 seconds).
7. Added startup dependency checks, including PocketBase reachability with retry and degraded-mode fallback.
8. Added global timeout protection for outbound fetch calls and inbound request timeout handling.

## Security and code quality improvements

9. Restricted sensitive startup configuration logging to non-production environments.
10. Added `/home/runner/work/trader-robot-/trader-robot-/apps/api/src/constants/rate-limits.js` for timeout/rate-limit/cache constants.
11. Added Coinbase call circuit-breaker protections and improved error handling in the live position guard.
12. Added request validation middleware for payload size/depth and symbol format checks; added total upload-size enforcement.

## New features

13. Added `GET /health/detailed` to report PocketBase, Coinbase, Supabase, and Redis status.
14. Added `/home/runner/work/trader-robot-/trader-robot-/apps/api/src/utils/startup-checks.js` for startup validation and connectivity probes.
15. Added correlation ID + latency request logging middleware in `main.js`.

## Compatibility notes

- Existing routes and payload formats are preserved.
- Startup now fails fast if `ORACLE_CREDENTIALS_ENCRYPTION_KEY` is missing.
- PocketBase unavailability at startup now logs degraded mode instead of hard-failing server boot.
