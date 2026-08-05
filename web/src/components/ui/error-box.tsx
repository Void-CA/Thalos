import type { ReactElement } from 'react'
import { XCircle } from 'lucide-react'
import { describeError } from '@/shared/errors'

/** Error shape carried by stores that preserve the backend machine-readable
 *  `code` alongside the display `message` (error-ux spec — ExecutionState). */
export interface ErrorBoxError {
  message: string
  code?: string
}

/** Resolve an arbitrary error input to a display string.
 *  - string → shown verbatim
 *  - coded error ({message, code?} / ApiError / CompileError) → describeError
 *    (code→CTA mapping, error-ux spec)
 *  - plain Error → its message
 */
function errorText(error: ErrorBoxError | Error | string): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return describeError(error)
  if ('code' in error) return describeError(error)
  return error.message
}

/** Shared ErrorBox — the single styled error container used by all workspaces.
 *  Accepts the structured execution-store error, any Error, or a plain string. */
export function ErrorBox({
  error,
}: {
  error: ErrorBoxError | Error | string | null
}): ReactElement | null {
  if (error == null) return null
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive-weak border border-destructive-weak text-xs text-destructive">
      <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{errorText(error)}</span>
    </div>
  )
}
