import { Plus, Trash2 } from 'lucide-react'
import type { SceneTool } from '../../store'

export interface ToolsSectionProps {
  tools: SceneTool[]
  addTool: (tool: SceneTool) => void
  removeTool: (id: string) => void
}

/**
 * Tools accordion section (ui-workspace-density R1): the tool list with
 * add/remove, moved verbatim from the pre-accordion SceneEditor. R11 — the
 * add/remove wiring is byte-identical.
 */
export function ToolsSection({ tools, addTool, removeTool }: ToolsSectionProps) {
  const nextSeq = tools.length + 1
  return (
    <div className="px-3 py-2 flex flex-col gap-1">
      <div className="flex items-center justify-end">
        <button
          aria-label="Add tool"
          onClick={() =>
            addTool({ id: `tool-${nextSeq}`, name: `Tool ${nextSeq}` })
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
    </div>
  )
}
