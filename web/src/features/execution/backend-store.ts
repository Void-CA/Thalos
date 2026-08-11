import { create } from 'zustand'
import { backendApi, type BackendDto } from './backend-api'
import { isApiError } from '@/shared/errors'

/** Structured backend-management error (error-ux spec): the backend
 *  machine-readable `code` is preserved so the selector can render the
 *  code→CTA label (Cambiar a simulación, Elegir otro puerto, …). */
export interface BackendError {
  message: string
  code?: string
}

/** Normalize any thrown error to `{message, code}`. */
function toBackendError(err: unknown): BackendError {
  if (isApiError(err)) {
    return { message: err.message, code: err.code }
  }
  return { message: err instanceof Error ? err.message : 'Backend operation failed' }
}

interface BackendState {
  backends: BackendDto[]
  activeId: string | null
  loading: boolean
  error: BackendError | null
  fetchBackends: () => Promise<void>
  activate: (id: string) => Promise<void>
  connect: (id: string, port: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
}

/**
 * Backend store (execution-backend-switch-ui spec): owns the registered
 * backend list, the active backend, and the connect/disconnect actions.
 * Every failure lands in `error` with the backend code preserved and leaves
 * `loading` false — the UI stays interactive (coherent end state).
 */
export const useBackendStore = create<BackendState>((set, get) => ({
  backends: [],
  activeId: null,
  loading: false,
  error: null,

  fetchBackends: async () => {
    set({ loading: true, error: null })
    try {
      const backends = await backendApi.list()
      const active = backends.find((b) => b.status === 'active') ?? null
      set({ backends, activeId: active?.id ?? null, loading: false })
    } catch (err) {
      console.error('[backend] fetchBackends failed', err)
      set({ loading: false, error: toBackendError(err) })
    }
  },

  activate: async (id) => {
    set({ error: null })
    try {
      await backendApi.activate(id)
      set({ activeId: id })
      await get().fetchBackends()
    } catch (err) {
      console.error('[backend] activate failed', id, err)
      set({ error: toBackendError(err) })
      throw err
    }
  },

  connect: async (id, port) => {
    set({ error: null })
    try {
      await backendApi.connect(id, port)
      await get().fetchBackends()
    } catch (err) {
      console.error('[backend] connect failed', id, port, err)
      set({ error: toBackendError(err) })
      throw err
    }
  },

  disconnect: async (id) => {
    set({ error: null })
    try {
      await backendApi.disconnect(id)
      await get().fetchBackends()
    } catch (err) {
      console.error('[backend] disconnect failed', id, err)
      set({ error: toBackendError(err) })
      throw err
    }
  },
}))
