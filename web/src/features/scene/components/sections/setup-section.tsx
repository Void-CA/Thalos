import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PoseDef, RobotRef } from '@/shared/contracts'

export interface SetupSectionProps {
  robot: RobotRef | null
  homePose: PoseDef
  setHomePose: (pose: PoseDef) => void
  approachHeight: number
  setApproachHeight: (value: number) => void
}

/**
 * Setup accordion section (ui-workspace-density R1/R2/R3): scene-wide
 * configuration in one collapsed-by-default-friendly block.
 *
 * - Robot identity renders as a single compact read-only `Robot: {name}` line
 *   (R2) — no standalone section.
 * - Home pose X/Y/Z inputs (wiring unchanged, R11).
 * - SCARA approach height as a single labeled line (R3).
 */
export function SetupSection({
  robot,
  homePose,
  setHomePose,
  approachHeight,
  setApproachHeight,
}: SetupSectionProps) {
  return (
    <div className="px-3 py-2 flex flex-col gap-2">
      {/* R2 — robot identity: compact read-only line inside Setup. */}
      <p className="text-[11px] text-foreground font-mono truncate">
        Robot: {robot?.name ?? '—'}
      </p>

      {/* Home pose — scene-wide config (same store wiring as before). */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground block">Home</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono">X</span>
          <input
            type="number"
            aria-label="Home X"
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
            aria-label="Home Y"
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
            aria-label="Home Z"
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
      </div>

      {/* R3 — SCARA approach height: prismatic transit retraction (always-on,
          MVP). Single labeled line with unit; the explanation lives in a ⓘ
          tooltip, never in permanent multi-line space. */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground font-mono">Approach height</span>
        <input
          type="number"
          aria-label="SCARA approach height (metres)"
          value={approachHeight}
          onChange={(e) => setApproachHeight(parseFloat(e.target.value) || 0)}
          step={0.01}
          min={0}
          className="w-16 px-1.5 py-0.5 text-[11px] rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-[10px] text-muted-foreground font-mono">m</span>
        <TooltipProvider delay={0}>
          <Tooltip>
            <TooltipTrigger
              aria-label="SCARA approach height help"
              className="inline-flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top">
              Prismatic retraction height — pick/place approach and retreat sit
              this far above the grasp point before descending.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
