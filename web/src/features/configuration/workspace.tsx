/**
 * ConfigurationWorkspace — non-stage shell (S5, area-configuration spec).
 *
 * Configuración is ORTHOGONAL to the pipeline: it has no consume/produce
 * artifacts, no stage and no stepper position (`stage: null` in the registry)
 * — it never appears in the stepper and never blocks navigation. This change
 * ships ONLY the structural shell: each future settings group (Solver IK,
 * Units, Backend/Simulator) renders as an empty section with a placeholder.
 * No functional settings exist yet (deferred to a future change) — the shell
 * projects nothing but its own structure.
 */
const SETTINGS_GROUPS = [
  { title: 'Solver IK', description: 'IK defaults and solver configuration' },
  { title: 'Units', description: 'Measurement units for the workspace' },
  { title: 'Backend / Simulator', description: 'Execution backend and simulator connection' },
]

export function ConfigurationWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Configuración
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-sm text-muted-foreground mb-4">Settings coming soon</p>

        <div className="space-y-3">
          {SETTINGS_GROUPS.map((group) => (
            <section
              key={group.title}
              className="rounded-md border border-border px-3 py-2.5"
            >
              <h3 className="text-xs font-semibold text-foreground">{group.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">{group.description}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Coming soon</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
