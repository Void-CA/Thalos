import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SemanticOp } from '@/shared/contracts'
import type { CompileResponse } from './types'
import type { ParseError } from './script/types'
import { parse } from './script/parser'
import { remapProgramToScene as remapOps } from '@/shared/workflow/derive'
import type { SceneResourceRef } from '@/shared/workflow/derive'

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
  /** Parse errors from the last text-mode commit attempt (program-dual-editor
   *  spec I5). DIAGNOSTIC ONLY: never touched by a failed parse, and never
   *  derived from the store — the text buffer stays component-local (P4).
   *  `replaceOperations`/`addOperation` etc. leave it untouched. */
  scriptErrors: ParseError[]
  /** Lifted buffer-divergence flag (task-code-sync-guards spec): true while
   *  the Code tab's text buffer holds text that differs from
   *  `serialize(operations)` (uncommitted edits). The TaskEditor keeps it in
   *  sync (set on divergence, cleared on Apply/commit); the workspace-level
   *  tab-switch guard reads it to warn before discarding the buffer. */
  hasUncommittedBuffer: boolean

  // Actions
  addOperation: (op: SemanticOp) => void
  removeOperation: (index: number) => void
  moveOperation: (from: number, to: number) => void
  updateOperation: (index: number, op: Partial<SemanticOp>) => void
  /** Atomic full-program replace (program-dual-editor spec I5): overwrites
   *  the ENTIRE operation set and bumps `dirty` (invalidating `compiled`).
   *  Used ONLY by the text-mode Apply path after `parse()` succeeds — a
   *  failed parse never reaches here (R2). */
  replaceOperations: (ops: SemanticOp[]) => void
  /** Record parse errors for inline + DiagnosticsPanel display. Bumps nothing,
   *  touches no program state — the program is written exclusively through
   *  `replaceOperations`. */
  setScriptErrors: (errors: ParseError[]) => void
  /** Load a `.thalos` program file (task-program-artifact spec "Load parses
   *  text"): parse via the dual parser, then atomically replace the ENTIRE
   *  operation set (dirty bump included). Returns the parse errors ([] on
   *  success) and NEVER mutates on a failed parse (R2 atomicity) or the
   *  domain scene store (Load Program ≠ Load Scene). */
  loadProgramText: (text: string) => ParseError[]
  /** Scene-load sync: re-map operation references to a freshly loaded scene
   *  (objects/locations by id+name). Pure `remapProgramToScene` — keeps the
   *  program executable after [Load Scene] replaces the scene (a program
   *  referencing the old scene's ids would fail at lowering with
   *  `unknown object`). Bumps `dirty` ONLY when a reference actually changed. */
  remapProgramToScene: (objects: SceneResourceRef[], locations: SceneResourceRef[]) => void
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
    (set, get) => ({
      operations: sampleOperations.map((op) => ({ ...op })),
      result: null,
      loading: false,
      error: null,
      dirty: 0,
      scriptErrors: [],
      hasUncommittedBuffer: false,

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

      replaceOperations: (ops) =>
        set((s) => ({
          operations: ops.map((o) => ({ ...o })),
          dirty: s.dirty + 1,
        })),

      setScriptErrors: (scriptErrors) => set({ scriptErrors }),

      loadProgramText: (text) => {
        const result = parse(text)
        // R2 atomicity: a failed parse returns the errors and writes NOTHING.
        if (result.ops === null) return result.errors
        get().replaceOperations(result.ops)
        return []
      },

      remapProgramToScene: (objects, locations) =>
        set((s) => {
          const next = remapOps(s.operations, objects, locations)
          // Reference-identical when nothing changed → skip the dirty bump so
          // a scene load never invalidates a compiled program needlessly.
          if (next === s.operations) return {}
          // `next` is a fresh array from `.map()` — only readonly by the pure
          // helper's signature; the store field is the mutable owner.
          return { operations: next as SemanticOp[], dirty: s.dirty + 1 }
        }),

      setResult: (result) =>
        set({ result, error: null, loading: false, dirty: 0 }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error, loading: false }),
      reset: () =>
        set({
          operations: sampleOperations.map((op) => ({ ...op })),
          result: null,
          error: null,
          loading: false,
          dirty: 0,
          scriptErrors: [],
          hasUncommittedBuffer: false,
        }),
    }),
    { name: 'semantic-editor' },
  ),
)
