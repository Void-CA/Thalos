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
