import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'thalos.workspace-panel-width'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 320
const MAX_WIDTH = 720
/** Panel may not eat more than 60% of the shell body (viewport needs the rest). */
const MAX_FRACTION = 0.6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = Number(raw)
    return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH
      ? value
      : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

interface DragState {
  pointerId: number
  startX: number
  startWidth: number
  maxWidth: number
}

/**
 * Resizable side panel (P0-A workspace-spatial-layout): renders the workspace
 * as a <main> with a pointer-driven drag handle on its right edge, so the
 * panel can grow past the old fixed 380px. Width persists to localStorage —
 * the user's choice survives navigation and reloads. Pointer events (not
 * mouse events) keep the drag working on touch/pen input; `touch-action:
 * none` on the handle opts out of scroll/pan gestures while dragging.
 */
export function ResizablePanel({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(readStoredWidth)
  const [dragging, setDragging] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const dragState = useRef<DragState | null>(null)
  const widthRef = useRef(width)
  widthRef.current = width

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const container = mainRef.current?.parentElement
    const containerMax = container
      ? Math.floor(container.clientWidth * MAX_FRACTION)
      : MAX_WIDTH
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: widthRef.current,
      maxWidth: Math.min(MAX_WIDTH, containerMax),
    }
    setDragging(true)
  }

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state || e.pointerId !== state.pointerId) return
    setWidth(clamp(state.startWidth + e.clientX - state.startX, MIN_WIDTH, state.maxWidth))
  }, [])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state || e.pointerId !== state.pointerId) return
    dragState.current = null
    setDragging(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(widthRef.current))
    } catch {
      // Storage unavailable (private mode) — the choice simply isn't persisted.
    }
  }, [])

  useEffect(() => {
    if (!dragging) return
    const originalUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = originalUserSelect
    }
  }, [dragging])

  return (
    <>
      <main ref={mainRef} style={{ width }} className="relative flex-shrink-0 overflow-hidden">
        {children}
      </main>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        aria-label="Resize workspace panel"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="w-[3px] shrink-0 cursor-col-resize touch-none select-none transition-colors hover:bg-white/25 active:bg-white/30 focus-visible:outline-none"
      />
    </>
  )
}
