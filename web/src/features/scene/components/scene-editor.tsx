import { Plus, Trash2 } from 'lucide-react'
import { useDomainSceneStore, defaultObjectPose, defaultLocationPose } from '../store'
import { PoseInputs } from './pose-inputs'

export function SceneEditor() {
  const objects = useDomainSceneStore((s) => s.objects)
  const locations = useDomainSceneStore((s) => s.locations)
  const tools = useDomainSceneStore((s) => s.tools)
  const homePose = useDomainSceneStore((s) => s.homePose)
  const addObject = useDomainSceneStore((s) => s.addObject)
  const removeObject = useDomainSceneStore((s) => s.removeObject)
  const updateObject = useDomainSceneStore((s) => s.updateObject)
  const addLocation = useDomainSceneStore((s) => s.addLocation)
  const removeLocation = useDomainSceneStore((s) => s.removeLocation)
  const updateLocation = useDomainSceneStore((s) => s.updateLocation)
  const addTool = useDomainSceneStore((s) => s.addTool)
  const removeTool = useDomainSceneStore((s) => s.removeTool)
  const setHomePose = useDomainSceneStore((s) => s.setHomePose)

  const nextSeq = {
    obj: objects.length + 1,
    loc: locations.length + 1,
    tool: tools.length + 1,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Objects */}
      <section className="px-3 py-2 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Objects
          </h3>
          <button
            aria-label="Add object"
            onClick={() =>
              addObject({
                id: `obj-${nextSeq.obj}`,
                name: `Object ${nextSeq.obj}`,
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
      </section>

      {/* Locations */}
      <section className="px-3 py-2 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Locations
          </h3>
          <button
            aria-label="Add location"
            onClick={() =>
              addLocation({
                id: `loc-${nextSeq.loc}`,
                name: `Location ${nextSeq.loc}`,
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
      </section>

      {/* Tools */}
      <section className="px-3 py-2 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Tools
          </h3>
          <button
            aria-label="Add tool"
            onClick={() =>
              addTool({ id: `tool-${nextSeq.tool}`, name: `Tool ${nextSeq.tool}` })
            }
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1">
          {tools.map((tool) => (
            <div key={tool.id} className="flex items-center gap-1.5 group">
              <span className="flex-1 text-[11px] text-foreground truncate px-1">
                {tool.name}
              </span>
              <button
                onClick={() => removeTool(tool.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          {tools.length === 0 && (
            <p className="text-[10px] text-muted-foreground/60 italic">
              No tools defined
            </p>
          )}
        </div>
      </section>

      {/* Home pose */}
      <section className="px-3 py-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1.5">
          Home
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono">X</span>
          <input
            type="number"
            value={homePose.position[0]}
            onChange={(e) =>
              setHomePose({
                ...homePose,
                position: [parseFloat(e.target.value) || 0, homePose.position[1], homePose.position[2]],
              })
            }
            step={0.1}
            className="w-14 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] text-muted-foreground font-mono">Y</span>
          <input
            type="number"
            value={homePose.position[1]}
            onChange={(e) =>
              setHomePose({
                ...homePose,
                position: [homePose.position[0], parseFloat(e.target.value) || 0, homePose.position[2]],
              })
            }
            step={0.1}
            className="w-14 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] text-muted-foreground font-mono">Z</span>
          <input
            type="number"
            value={homePose.position[2]}
            onChange={(e) =>
              setHomePose({
                ...homePose,
                position: [homePose.position[0], homePose.position[1], parseFloat(e.target.value) || 0],
              })
            }
            step={0.1}
            className="w-14 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </section>
    </div>
  )
}
