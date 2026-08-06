import { useEffect, useRef, useState } from 'react'
import { Loader2, Plug, Unplug, Cpu } from 'lucide-react'
import { useBackendStore } from '../backend-store'
import { ctaLabelForCode } from '@/shared/errors'

/**
 * BackendSelector (execution-backend-switch-ui spec) — replaces the
 * informational backend badge in the Execution workspace.
 *
 * Shows the registered backends (Simulation / Hardware), highlights the active
 * one, and drives the backend lifecycle: activate on selection, connect /
 * disconnect with a serial-port input, and code→CTA recovery for
 * `no_firmware` (Cambiar a simulación), `port_in_use` (Elegir otro puerto)
 * and `connection_lost` (Reconectar). Every failure leaves the selector
 * interactive — buttons re-enabled, spinner stopped (coherent end state).
 */
export function BackendSelector() {
  const backends = useBackendStore((s) => s.backends)
  const activeId = useBackendStore((s) => s.activeId)
  const loading = useBackendStore((s) => s.loading)
  const error = useBackendStore((s) => s.error)
  const fetchBackends = useBackendStore((s) => s.fetchBackends)
  const activate = useBackendStore((s) => s.activate)
  const connect = useBackendStore((s) => s.connect)
  const disconnect = useBackendStore((s) => s.disconnect)

  const [portInput, setPortInput] = useState('')
  const portInputRef = useRef<HTMLInputElement>(null)

  // Fetch the backend list on mount — but never clobber an already-loaded
  // (or store-seeded) state: the store is the source of truth once populated.
  useEffect(() => {
    if (backends.length === 0) void fetchBackends()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBackends])

  const active = backends.find((b) => b.id === activeId) ?? null
  const isHardwareActive = active?.id === 'esp32'
  const hardwareConnected = isHardwareActive ? (active?.connected ?? false) : false

  // Prefill the port input from the active hardware backend's DTO port
  // (spec: pre-filled with the default port from THALOS_SERIAL_PORT env).
  useEffect(() => {
    if (active?.port && portInput === '') setPortInput(active.port)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.port])

  const activeLabel = active
    ? isHardwareActive
      ? `Hardware (${hardwareConnected ? 'Connected' : 'Disconnected'})`
      : 'Simulation'
    : 'No backend'

  const handleCta = () => {
    if (!error?.code) {
      void fetchBackends()
      return
    }
    switch (error.code) {
      case 'no_firmware':
        // Spec: the CTA switches to the Simulation backend.
        void activate('simulation')
        break
      case 'port_in_use':
        // Spec: the CTA focuses the port input for re-entry.
        portInputRef.current?.focus()
        break
      case 'connection_lost':
        if (active) void connect(active.id, portInput || active.port || '')
        break
      default:
        void fetchBackends()
    }
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-44">
      <div className="flex items-center gap-1">
        {loading ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" data-testid="backend-loading" />
        ) : (
          <Cpu className="size-3 text-muted-foreground" />
        )}
        <span data-testid="backend-active-label" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {activeLabel}
        </span>
      </div>

      <div className="flex gap-1">
        {backends.map((b) => (
          <button
            key={b.id}
            aria-pressed={activeId === b.id}
            onClick={() => void activate(b.id)}
            className={`px-2 py-1 text-[10px] font-medium rounded-md border cursor-pointer transition-colors
              ${activeId === b.id
                ? 'bg-blue-600/20 text-blue-400 border-blue-600/40'
                : 'bg-background/60 text-muted-foreground border-border hover:text-foreground hover:bg-secondary/50'}`}
          >
            {b.id === 'esp32' ? 'Hardware' : 'Simulation'}
          </button>
        ))}
      </div>

      {isHardwareActive && (
        <div className="flex items-center gap-1">
          <input
            ref={portInputRef}
            aria-label="Puerto"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            placeholder="/dev/ttyUSB0"
            className="flex-1 px-1.5 py-1 text-[10px] font-mono bg-input border border-border rounded-md text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring-weak"
          />
          {hardwareConnected ? (
            <button
              onClick={() => active && void disconnect(active.id)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive-mid cursor-pointer"
            >
              <Unplug className="size-2.5" /> Desconectar
            </button>
          ) : (
            <button
              onClick={() => active && void connect(active.id, portInput)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-green-600/20 text-green-500 hover:bg-green-600/30 cursor-pointer"
            >
              <Plug className="size-2.5" /> Conectar
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-destructive">{error.message}</span>
          <button
            onClick={handleCta}
            className="px-2 py-1 text-[10px] font-medium rounded-md border border-destructive-mid text-destructive hover:bg-destructive/10 cursor-pointer"
          >
            {ctaLabelForCode(error.code)}
          </button>
        </div>
      )}
    </div>
  )
}
