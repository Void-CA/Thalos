import { create } from 'zustand'

export type Perspective = 'robot' | 'task' | 'planning' | 'analysis' | 'execution' | 'sessions' | 'knowledge'

const STORAGE_KEY = 'thalos-perspective'

function getStored(): Perspective | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && ['robot', 'task', 'planning', 'analysis', 'execution', 'sessions', 'knowledge'].includes(v)) {
      return v as Perspective
    }
  } catch { /* noop */ }
  return null
}

function persist(p: Perspective) {
  try { localStorage.setItem(STORAGE_KEY, p) } catch { /* noop */ }
}

interface PerspectiveState {
  perspective: Perspective
  setPerspective: (p: Perspective) => void
  cycle: () => void
}

const ORDER: Perspective[] = ['robot', 'task', 'planning', 'execution', 'knowledge', 'sessions']

export const usePerspectiveStore = create<PerspectiveState>((set) => ({
  perspective: getStored() ?? 'robot',

  setPerspective: (p) => {
    persist(p)
    set({ perspective: p })
  },

  cycle: () => {
    set((s) => {
      const idx = ORDER.indexOf(s.perspective)
      const next = ORDER[(idx + 1) % ORDER.length]
      persist(next)
      return { perspective: next }
    })
  },
}))
