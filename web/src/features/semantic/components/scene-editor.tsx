import { Plus, Trash2 } from 'lucide-react'
import { useSceneStore } from '../scene-store'

export function SceneEditor() {
  const objects = useSceneStore((s) => s.objects)
  const locations = useSceneStore((s) => s.locations)
  const tools = useSceneStore((s) => s.tools)
  const homePose = useSceneStore((s) => s.homePose)
  const addObject = useSceneStore((s) => s.addObject)
  const removeObject = useSceneStore((s) => s.removeObject)
  const updateObject = useSceneStore((s) => s.updateObject)
  const addLocation = useSceneStore((s) => s.addLocation)
  const removeLocation = useSceneStore((s) => s.removeLocation)
  const updateLocation = useSceneStore((s) => s.updateLocation)
  const addTool = useSceneStore((s) => s.addTool)
  const removeTool = useSceneStore((s) => s.removeTool)
  const setHomePose = useSceneStore((s) => s.setHomePose)

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
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Objects
          </span>
          <button
            onClick={() =>
              addObject({
                id: `obj-${nextSeq.obj}`,
                name: `Object ${nextSeq.obj}`,
                pose: { position: [0.5, 0, 0], orientation: [0, 0, 0, 1] },
              })
            }
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {objects.map((obj) => (
            <div
              key={obj.id}
              className="flex items-center gap-1.5 group"
            >
              <input
                value={obj.name}
                onChange={(e) => updateObject(obj.id, { name: e.target.value })}
                className="flex-1 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background
                           text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground font-mono w-16 text-right truncate"
                title={`${obj.pose.position[0]}, ${obj.pose.position[1]}, ${obj.pose.position[2]}`}>
                {obj.pose.position[0].toFixed(1)}, {obj.pose.position[1].toFixed(1)}
              </span>
              <button
                onClick={() => removeObject(obj.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3" />
              </button>
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
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Locations
          </span>
          <button
            onClick={() =>
              addLocation({
                id: `loc-${nextSeq.loc}`,
                name: `Location ${nextSeq.loc}`,
                pose: { position: [0.8, -0.3, 0], orientation: [0, 0, 0, 1] },
              })
            }
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center gap-1.5 group">
              <input
                value={loc.name}
                onChange={(e) => updateLocation(loc.id, { name: e.target.value })}
                className="flex-1 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background
                           text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground font-mono w-16 text-right truncate">
                {loc.pose.position[0].toFixed(1)}, {loc.pose.position[1].toFixed(1)}
              </span>
              <button
                onClick={() => removeLocation(loc.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3" />
              </button>
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
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Tools
          </span>
          <button
            onClick={() =>
              addTool({ id: `tool-${nextSeq.tool}`, name: `Tool ${nextSeq.tool}` })
            }
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
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
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1.5">
          Home
        </span>
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
            className="w-14 px-1 py-0.5 text-[11px] rounded border border-border bg-background text-foreground"
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
            className="w-14 px-1 py-0.5 text-[11px] rounded border border-border bg-background text-foreground"
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
            className="w-14 px-1 py-0.5 text-[11px] rounded border border-border bg-background text-foreground"
          />
        </div>
      </section>
    </div>
  )
}
