import { create } from 'zustand'

const STORAGE_KEY = 'thalos-layout'

interface LayoutState {
  leftWidth: number
  rightWidth: number
  bottomHeight: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  bottomCollapsed: boolean
}

const DEFAULTS: LayoutState = {
  leftWidth: 220,
  rightWidth: 320,
  bottomHeight: 200,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,
}

const MIN_PANEL = 60
const MAX_PANEL_PCT = 0.6

function loadState(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveState(state: LayoutState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* noop */ }
}

interface LayoutActions {
  setLeftWidth: (px: number) => void
  setRightWidth: (px: number) => void
  setBottomHeight: (px: number) => void
  toggleLeft: () => void
  toggleRight: () => void
  toggleBottom: () => void
}

export type LayoutStore = LayoutState & LayoutActions

export const useLayoutStore = create<LayoutStore>((set) => {
  const initial = loadState()

  return {
    ...initial,

    setLeftWidth: (px) => set((s) => {
      const max = typeof window !== 'undefined' ? Math.round(window.innerWidth * MAX_PANEL_PCT) : 600
      const clamped = Math.max(MIN_PANEL, Math.min(px, max))
      const next = { ...s, leftWidth: clamped, leftCollapsed: false }
      saveState(next)
      return next
    }),

    setRightWidth: (px) => set((s) => {
      const max = typeof window !== 'undefined' ? Math.round(window.innerWidth * MAX_PANEL_PCT) : 600
      const clamped = Math.max(MIN_PANEL, Math.min(px, max))
      const next = { ...s, rightWidth: clamped, rightCollapsed: false }
      saveState(next)
      return next
    }),

    setBottomHeight: (px) => set((s) => {
      const max = typeof window !== 'undefined' ? Math.round(window.innerHeight * MAX_PANEL_PCT) : 600
      const clamped = Math.max(MIN_PANEL, Math.min(px, max))
      const next = { ...s, bottomHeight: clamped, bottomCollapsed: false }
      saveState(next)
      return next
    }),

    toggleLeft: () => set((s) => {
      const next = { ...s, leftCollapsed: !s.leftCollapsed }
      saveState(next)
      return next
    }),

    toggleRight: () => set((s) => {
      const next = { ...s, rightCollapsed: !s.rightCollapsed }
      saveState(next)
      return next
    }),

    toggleBottom: () => set((s) => {
      const next = { ...s, bottomCollapsed: !s.bottomCollapsed }
      saveState(next)
      return next
    }),
  }
})
