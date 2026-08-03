import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SemanticOp } from '@/shared/contracts'
import type { CompileResponse } from './types'

interface SemanticEditorState {
  /** Ordered list of operations in the editor */
  operations: SemanticOp[]
  /** The compile result (null = not compiled yet) */
  result: CompileResponse | null
  /** Whether a compile request is in flight */
  loading: boolean
  /** Error message if compile failed */
  error: string | null
  /** Edit counter — bumps on every operation mutation, resets on successful
   *  compile. `deriveWorkflowState` uses it to invalidate `compiled`
   *  (workflow-state spec, "Dirty Counter"). */
  dirty: number

  // Actions
  addOperation: (op: SemanticOp) => void
  removeOperation: (index: number) => void
  moveOperation: (from: number, to: number) => void
  updateOperation: (index: number, op: Partial<SemanticOp>) => void
  setResult: (result: CompileResponse | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

/** Canonical sample program — Pick → Wait → Place → Home over the seeded scene. */
const sampleOperations: SemanticOp[] = [
  { type: 'pick', origin: 'op_1', object: 'bolt-1' },
  { type: 'wait', origin: 'op_2', duration: { secs: 1, nanos: 0 } },
  { type: 'place', origin: 'op_3', object: 'bolt-1', destination: 'tray-1' },
  { type: 'home', origin: 'op_4' },
]

export const useSemanticEditor = create<SemanticEditorState>()(
  devtools(
    (set) => ({
      operations: sampleOperations.map((op) => ({ ...op })),
      result: null,
      loading: false,
      error: null,
      dirty: 0,

      addOperation: (op) =>
        set((s) => ({ operations: [...s.operations, op], dirty: s.dirty + 1 })),

      removeOperation: (index) =>
        set((s) => ({
          operations: s.operations.filter((_, i) => i !== index),
          dirty: s.dirty + 1,
        })),

      moveOperation: (from, to) =>
        set((s) => {
          const ops = [...s.operations]
          const [moved] = ops.splice(from, 1)
          ops.splice(to, 0, moved)
          return { operations: ops, dirty: s.dirty + 1 }
        }),

      updateOperation: (index, op) =>
        set((s) => ({
          operations: s.operations.map((o, i) =>
            i === index ? { ...o, ...op } : o,
          ),
          dirty: s.dirty + 1,
        })),

      setResult: (result) =>
        set({ result, error: null, loading: false, dirty: 0 }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error, loading: false }),
      reset: () =>
        set({
          operations: sampleOperations.map((op) => ({ ...op })),
          result: null,
          error: null,
          dirty: 0,
        }),
    }),
    { name: 'semantic-editor' },
  ),
)
