import { useWorkspaceStore, type PointCloudColorMode } from '../store/workspace-store'

/**
 * Workspace Panel — point-cloud visualization controls.
 *
 * PR-C: the sampling config, "Run Analysis" trigger and inline results moved
 * to AnalysisWorkspace (/analysis, PR-D). This panel keeps only the
 * point-cloud color mode selector and visibility toggle, so the samples can
 * be inspected against the live 3D viewport.
 */
export function WorkspacePanel() {
  const colorMode = useWorkspaceStore(s => s.colorMode)
  const setColorMode = useWorkspaceStore(s => s.setColorMode)
  const showPointCloud = useWorkspaceStore(s => s.showPointCloud)
  const setShowPointCloud = useWorkspaceStore(s => s.setShowPointCloud)
  const hasAnySamples = useWorkspaceStore(s =>
    s.workspaceSamples !== null || s.singularitySamples !== null || s.manipulabilitySamples !== null)

  const modes: { key: PointCloudColorMode; label: string }[] = [
    { key: 'none', label: 'None' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'singularity', label: 'Singularity' },
    { key: 'manipulability', label: 'Manipulability' },
  ]

  return (
    <div className="flex flex-col gap-3">
      {hasAnySamples && (
        <div className="border-t border-border pt-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Point Cloud Color
          </span>
          <div className="grid grid-cols-2 gap-1">
            {modes.map(m => (
              <button
                key={m.key}
                onClick={() => setColorMode(m.key)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-all cursor-pointer
                  ${colorMode === m.key
                    ? 'bg-primary-weak border-primary-mid text-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Toggle visible solo si hay un color mode activo */}
          {colorMode !== 'none' && (
            <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
              <input
                type="checkbox"
                checked={showPointCloud}
                onChange={e => setShowPointCloud(e.target.checked)}
                className="accent-primary w-3.5 h-3.5 rounded border-border"
              />
              <span className="text-xs text-muted-foreground">Show Point Cloud</span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
