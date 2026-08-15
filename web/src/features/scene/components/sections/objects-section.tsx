import { Plus, Trash2 } from 'lucide-react'
import { PoseInputs } from '../pose-inputs'
import { defaultObjectPose, type SceneObject } from '../../store'

export interface ObjectsSectionProps {
  objects: SceneObject[]
  addObject: (obj: SceneObject) => void
  removeObject: (id: string) => void
  updateObject: (id: string, patch: Partial<SceneObject>) => void
}

/**
 * Objects accordion section (ui-workspace-density R1/R5): the scene object
 * list with name + PoseInputs, moved verbatim from the pre-accordion
 * SceneEditor. R11 — add/remove/update wiring is byte-identical.
 */
export function ObjectsSection({ objects, addObject, removeObject, updateObject }: ObjectsSectionProps) {
  const nextSeq = objects.length + 1
  return (
    <div className="px-3 py-2 flex flex-col gap-1">
      <div className="flex items-center justify-end">
        <button
          aria-label="Add object"
          onClick={() =>
            addObject({
              id: `obj-${nextSeq}`,
              name: `Object ${nextSeq}`,
              // Design D6: add defaults come from the store — no inline literals.
              pose: { ...defaultObjectPose },
            })
          }
          className="text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {objects.map((obj) => (
          <div key={obj.id} className="flex flex-col gap-0.5 group">
            <div className="flex items-center gap-1.5">
              <input
                value={obj.name}
                onChange={(e) => updateObject(obj.id, { name: e.target.value })}
                className="flex-1 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background
                           text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                aria-label={`Remove ${obj.name}`}
                onClick={() => removeObject(obj.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            <PoseInputs
              pose={obj.pose}
              onChange={(pose) => updateObject(obj.id, { pose })}
              idPrefix={obj.id}
            />
          </div>
        ))}
        {objects.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60 italic">
            No objects defined
          </p>
        )}
      </div>
    </div>
  )
}
