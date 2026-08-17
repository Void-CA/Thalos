import { Plus, Trash2 } from 'lucide-react'
import { PoseInputs } from '../pose-inputs'
import { defaultLocationPose, type SceneLocation } from '../../store'

export interface LocationsSectionProps {
  locations: SceneLocation[]
  addLocation: (loc: SceneLocation) => void
  removeLocation: (id: string) => void
  updateLocation: (id: string, patch: Partial<SceneLocation>) => void
}

/**
 * Locations accordion section (ui-workspace-density R1/R5): placement targets
 * with name + PoseInputs, moved verbatim from the pre-accordion SceneEditor.
 * R11 — add/remove/update wiring is byte-identical.
 */
export function LocationsSection({ locations, addLocation, removeLocation, updateLocation }: LocationsSectionProps) {
  const nextSeq = locations.length + 1
  return (
    <div className="px-3 py-2 flex flex-col gap-1">
      <div className="flex items-center justify-end">
        <button
          aria-label="Add location"
          onClick={() =>
            addLocation({
              id: `loc-${nextSeq}`,
              name: `Location ${nextSeq}`,
              // Design D6: add defaults come from the store — no inline literals.
              pose: { ...defaultLocationPose },
            })
          }
          className="text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {locations.map((loc) => (
          <div key={loc.id} className="flex flex-col gap-0.5 group">
            <div className="flex items-center gap-1.5">
              <input
                value={loc.name}
                onChange={(e) => updateLocation(loc.id, { name: e.target.value })}
                className="flex-1 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background
                           text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                aria-label={`Remove ${loc.name}`}
                onClick={() => removeLocation(loc.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            <PoseInputs
              pose={loc.pose}
              onChange={(pose) => updateLocation(loc.id, { pose })}
              idPrefix={loc.id}
            />
          </div>
        ))}
        {locations.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60 italic">
            No locations defined
          </p>
        )}
      </div>
    </div>
  )
}
