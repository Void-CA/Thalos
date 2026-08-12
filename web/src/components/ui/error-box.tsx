import type { ReactElement } from 'react'
import { XCircle } from 'lucide-react'
import { ctaLabelForCode, describeError, isCodedError } from '@/shared/errors'

/** Error shape carried by stores that preserve the backend machine-readable
 *  `code` alongside the display `message` (error-ux spec — ExecutionState). */
export interface ErrorBoxError {
  message: string
  code?: string
}

/** Resolve an arbitrary error input to a display string.
 *  - string → shown verbatim
 *  - coded error ({message, code?} with a REAL code / ApiError / CompileError)
 *    → describeError (code→CTA mapping, error-ux spec)
 *  - {message, code: undefined} (network errors) → the real message, NEVER the
 *    generic fallback (R3-003 — `'code' in error` is true but the value is not
 *    a string, so it must not be routed to describeError)
 *  - plain Error → its message
 */
function errorText(error: ErrorBoxError | Error | string): string {
  if (typeof error === 'string') return error
  if (isCodedError(error)) return describeError(error)
  return error.message
}

/** Shared ErrorBox — the single styled error container used by all workspaces.
 *  Accepts the structured execution-store error, any Error, or a plain string.
 *
 *  When `onRetry` is provided AND the error carries a machine-readable code,
 *  a CTA button with the code-specific label ("Retry", "Reconnect",
 *  "Switch to Simulation", …) is rendered — the resilience-matrix retry
 *  affordance (error-ux spec, "ErrorBox with Retry Button"). Without a code,
 *  `onRetry` renders a plain "Retry" fallback. Without `onRetry` the box
 *  stays read-only (R3-003 non-coded fallback untouched). */
export function ErrorBox({
  error,
  onRetry,
}: {
  error: ErrorBoxError | Error | string | null
  onRetry?: () => void
}): ReactElement | null {
  if (error == null) return null
  const coded = typeof error !== 'string' ? isCodedError(error) : false
  const label = coded && typeof error === 'object' && error !== null
    ? ctaLabelForCode((error as ErrorBoxError).code)
    : 'Retry'
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-2 rounded-lg bg-destructive-weak border border-destructive-weak text-xs text-destructive">
      <div className="flex items-start gap-2 w-full">
        <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>{errorText(error)}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-destructive-mid text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {label}
        </button>
      )}
    </div>
  )
}
