import { GripVertical, Trash2 } from 'lucide-react'
import type { SemanticOp } from '../types'
import { useSceneStore } from '../scene-store'

interface OperationRowProps {
  op: SemanticOp
  index: number
  total: number
  onChange: (index: number, op: Partial<SemanticOp>) => void
  onRemove: (index: number) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
}

const TYPE_OPTIONS = [
  { value: 'pick', label: 'Pick' },
  { value: 'place', label: 'Place' },
  { value: 'move_to', label: 'Move To' },
  { value: 'wait', label: 'Wait' },
  { value: 'home', label: 'Home' },
] as const

export function OperationRow({
  op,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: OperationRowProps) {
  const objects = useSceneStore((s) => s.objects)
  const locations = useSceneStore((s) => s.locations)
  const tools = useSceneStore((s) => s.tools)

  const update = (partial: Partial<SemanticOp>) => onChange(index, partial)

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-border/50 bg-card/30 hover:bg-card/50 transition-colors group">
      {/* Drag handle */}
      <div className="flex flex-col gap-0.5 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          className="text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
        >
          <GripVertical className="size-3 rotate-90" />
        </button>
        <button
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1}
          className="text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
        >
          <GripVertical className="size-3 -rotate-90" />
        </button>
      </div>

      {/* Number */}
      <span className="text-xs text-muted-foreground font-mono mt-1.5 min-w-4">
        {index + 1}
      </span>

      {/* Type selector */}
      <select
        value={op.type}
        onChange={(e) => update({ type: e.target.value as SemanticOp['type'] })}
        className="px-2 py-1.5 text-xs font-medium rounded-md border border-border bg-background
                   text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Dynamic fields */}
      <div className="flex flex-wrap gap-2 flex-1">
        {/* Pick / Place: object selector */}
        {(op.type === 'pick' || op.type === 'place') && (
          <select
            value={op.object ?? ''}
            onChange={(e) => update({ object: e.target.value })}
            className="px-2 py-1.5 text-xs rounded-md border border-border bg-background
                       text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            <option value="" disabled>
              Object…
            </option>
            {objects.map((obj) => (
              <option key={obj.id} value={obj.id}>
                {obj.name}
              </option>
            ))}
          </select>
        )}

        {/* Place / MoveTo: location selector */}
        {(op.type === 'place' || op.type === 'move_to') && (
          <select
            value={op.destination ?? ''}
            onChange={(e) => update({ destination: e.target.value })}
            className="px-2 py-1.5 text-xs rounded-md border border-border bg-background
                       text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            <option value="" disabled>
              {op.type === 'place' ? 'Destination…' : 'Location…'}
            </option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        )}

        {/* Wait: duration */}
        {op.type === 'wait' && (
          <input
            type="number"
            placeholder="Seconds"
            value={op.duration_secs ?? ''}
            onChange={(e) => update({ duration_secs: parseFloat(e.target.value) || 0 })}
            min={0}
            step={0.1}
            className="px-2 py-1.5 text-xs rounded-md border border-border bg-background
                       text-foreground placeholder:text-muted-foreground/50 w-20
                       focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        {/* Tool selector (not for home/wait) */}
        {op.type !== 'home' && op.type !== 'wait' && (
          <select
            value={op.tool ?? ''}
            onChange={(e) => update({ tool: e.target.value || undefined })}
            className="px-2 py-1.5 text-xs rounded-md border border-border bg-background
                       text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            <option value="">No tool</option>
            {tools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(index)}
        className="p-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100
                   transition-all cursor-pointer"
        title="Remove operation"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}
