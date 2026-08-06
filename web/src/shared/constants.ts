/**
 * Shared application constants.
 *
 * Single source of truth for cross-cutting values. Deliberately NOT
 * environment-configurable: `API_TIMEOUT_MS` is a fixed 10s that every HTTP
 * request shares (resilience-matrix-frontend spec, "Shared Timeout
 * Configuration") — a generous ceiling for the local demo that keeps the
 * timeout testable and drift-free.
 */
export const API_TIMEOUT_MS = 10_000
