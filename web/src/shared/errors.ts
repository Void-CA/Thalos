/**
 * Normalized HTTP error contract.
 *
 * The backend always answers errors as `{ error: string, code: string }`
 * (ErrorResponse) with an HTTP status mapped from the backend `ApiError`
 * enum (Validation→422, Conflict→409, InvalidState→412, NotFound→404,
 * Unsupported→501, Internal→500). `ApiError` preserves status/code/payload
 * so callers can branch on machine-readable codes instead of message
 * string-matching. This module intentionally does NOT import the axios
 * instance — consumers can import it without pulling the HTTP client.
 */

export class ApiError extends Error {
  readonly status?: number
  readonly code?: string
  readonly details?: unknown
  /** Native ES2022 `Error.cause`, set via `super(message, { cause })`.
   *  Declared as ambient (`declare`) so it types the native property WITHOUT
   *  emitting a class-field initializer — a plain field would overwrite the
   *  cause set by `super()` with `undefined`. */
  declare readonly cause?: unknown

  constructor(
    message: string,
    init?: { status?: number; code?: string; details?: unknown; cause?: unknown },
  ) {
    super(message, { cause: init?.cause })
    this.name = 'ApiError'
    this.status = init?.status
    this.code = init?.code
    this.details = init?.details
  }
}

/** Narrowing guard for error branches that receive `unknown`. */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

// ── describeError — centralized code→CTA mapping (error-ux spec) ───────────

/** Friendly guided CTAs keyed on the backend machine-readable error code
 *  (verbatim codes from `backend/crates/thalos-api/src/features/semantic/handler.rs`
 *  and the execution flow). The HTTP status is complementary only — decisions
 *  key on `code`. Lifted from task-editor.tsx (PR4, item 7). */
export const CTA_BY_CODE: Record<string, string> = {
  no_active_plan: 'Preview a motion program in Programación first',
  semantic_validation_error: 'Fix the program errors',
  lowering_error: 'Define the referenced objects/locations in Scene',
  planning_error: 'Planning failed — check the robot and scene targets',
  dof_mismatch: 'The loaded robot does not match this task\'s degrees of freedom — select a compatible robot',
  // Resilience matrix (resilience-presentation): network/timeout come from the
  // interceptor wrapping; firmware/port/connection codes come from the backend
  // execution-management API. All flow through describeError → CTA_BY_CODE.
  network_error: 'Backend is offline — check the connection and retry',
  timeout_error: 'Request timed out — retry or check backend health',
  no_firmware: 'No firmware detected — switch to Simulation or check the port',
  port_in_use: 'Port is in use — choose another port or disconnect the other process',
  connection_lost: 'Connection lost — reconnect to resume',
  // R3-001: start without a connected hardware backend (esp32 active but never
  // connected, or disconnected while active) — the CTA connects the backend.
  not_connected: 'Hardware backend is not connected — connect it to start',
  not_found: 'Robot not found — return to the catalog',
}

/** Short actionable button label for an error code (error-ux spec, "ErrorBox
 *  with Retry Button"). Falls back to "Reintentar" for unknown codes. */
export function ctaLabelForCode(code: string | undefined): string {
  switch (code) {
    case 'no_firmware':
      return 'Cambiar a simulación'
    case 'port_in_use':
      return 'Elegir otro puerto'
    case 'connection_lost':
      return 'Reconectar'
    case 'not_connected':
      return 'Conectar'
    case 'not_found':
      return 'Volver al catálogo'
    case 'semantic_validation_error':
    case 'lowering_error':
    case 'planning_error':
      return 'Recompilar'
    default:
      return 'Reintentar'
  }
}

/** `planning_error` is a generic code — the message is the only signal. IK
 *  failure signatures mean an unreachable/incompatible target, which deserves
 *  a reach-specific CTA; everything else falls back to the generic one above. */
const IK_FAILURE_MARKERS = ['IK failed', 'MaxIterations']
const REACH_CTA = 'Targets are out of the robot\'s reach — adjust scene positions or load a larger robot'

export function reachCtaForPlanningError(message: string): string | null {
  return IK_FAILURE_MARKERS.some(marker => message.includes(marker)) ? REACH_CTA : null
}

interface CodedError {
  message: string
  code?: string
  status?: number
}

/** Structural guard: matches `ApiError` and the semantic feature's
 *  `CompileError` (both extend Error and carry optional `code`/`status`) and
 *  plain `{message, code?}` shapes (execution-store `ExecutionError`) WITHOUT
 *  importing either — shared/errors must not depend on features.
 *  Exported so consumers can route an error to describeError only when it is
 *  genuinely coded (R3-003: `{message, code: undefined}` is NOT coded). */
export function isCodedError(err: unknown): err is CodedError {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as CodedError
  return (
    typeof candidate.message === 'string' &&
    (typeof candidate.code === 'string' ||
      typeof candidate.status === 'number')
  )
}

/** Map a normalized HTTP error (ApiError / CompileError / {message, code}) to
 *  a guided CTA. Keys on `code` first; HTTP `status` is complementary display
 *  only. */
export function describeError(err: unknown): string {
  if (isCodedError(err)) {
    const coded = err as CodedError
    if (coded.code === 'planning_error' && coded.message) {
      const reachCta = reachCtaForPlanningError(coded.message)
      if (reachCta) return `${reachCta} — ${coded.message}`
    }
    if (coded.code && CTA_BY_CODE[coded.code]) {
      return `${CTA_BY_CODE[coded.code]} — ${coded.message}`
    }
    if (coded.code) {
      return coded.status != null
        ? `${coded.message} (${coded.code}, HTTP ${coded.status})`
        : `${coded.message} (${coded.code})`
    }
    return coded.message
  }
  return err instanceof Error ? err.message : 'Operation failed'
}
