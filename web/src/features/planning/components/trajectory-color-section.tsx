import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { TrajectoryColorPicker } from './trajectory-color-picker'

/**
 * TrajectoryColorSection — the trajectory color mode picker wrapped in a
 * collapsed-by-default Accordion. Reused across ALL three Programming tabs
 * (Task, Motion, Code) so the trajectory coloring control is available wherever
 * the user authors a plan, without consuming vertical space until expanded.
 */
export function TrajectoryColorSection() {
  return (
    <Accordion className="rounded-lg border border-border/50">
      <AccordionItem value="trajectory-color" className="px-3">
        <AccordionTrigger className="uppercase tracking-wider">
          <span className="text-xs font-semibold text-foreground">Trajectory Color</span>
        </AccordionTrigger>
        <AccordionContent className="pt-1">
          <TrajectoryColorPicker />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}