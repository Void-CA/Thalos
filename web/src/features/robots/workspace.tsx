import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { TOOLS_BY_PERSPECTIVE } from '@/features/viewport/components/tools-registry'
import { RobotCatalog } from './components/robot-catalog'

/**
 * RobotShell — landing workspace (`/`).
 *
 * Robot catalog plus the scene tools (FK / IK / TCP / Workspace Analysis) in
 * one side panel. P0-B reorg: Workspace Analysis moved from the standalone
 * /analysis route INTO this accordion (TOOLS_BY_PERSPECTIVE.robot), so it
 * renders inline beside the persistent 3D viewport. The 3D viewport itself
 * lives in the layout route (invariant #1) and is NOT part of this shell.
 */
export function RobotShell() {
  const tools = TOOLS_BY_PERSPECTIVE.robot ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Robots
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <RobotCatalog />

        {tools.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
              Tools
            </h2>
            {/* All panels closed by default (product-quality item 6):
                Base UI is already single-open (`multiple` false); without a
                defaultValue the accordion starts all-closed. */}
            <Accordion className="w-full">
              {tools.map((tool) => (
                <AccordionItem key={tool.id} value={tool.id} className="border-b border-border last:border-b-0">
                  <AccordionTrigger className="px-3 py-2 pr-2 text-xs font-semibold text-foreground hover:no-underline hover:bg-accent/40 cursor-pointer [&>svg]:text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
                    {tool.label}
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-1.5">
                    <tool.component />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}
      </div>
    </div>
  )
}
