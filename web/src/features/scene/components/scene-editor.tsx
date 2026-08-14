import { useRef, useState, type ChangeEvent } from 'react'
import {
  useDomainSceneStore, isSceneFile,
} from '../store'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { SetupSection } from './sections/setup-section'
import { ObjectsSection } from './sections/objects-section'
import { LocationsSection } from './sections/locations-section'
import { ToolsSection } from './sections/tools-section'
import { downloadTextFile } from '@/shared/download'
import type { SceneFile } from '@/shared/contracts'

export interface SceneEditorProps {
  /** Demo-API scene loader (D12 "Load = local file picker OR demo API"),
   *  injected by the Demos workspace (Slice 4). When provided, [Load Scene]
   *  fetches via this loader; otherwise it opens the local file picker. */
  loadDemoScene?: () => Promise<SceneFile>
}

/**
 * SceneEditor — density refactor (ui-workspace-density spec R1/R2/R3/R11).
 *
 * The panel is an Accordion with four sections in fixed order:
 * Setup (open by default — scene-wide config) / Objects / Locations / Tools
 * (collapsed by default — entity-specific lists, minimal context). `multiple`
 * keeps the pre-refactor UX where any set of sections can stay open at once.
 * Zero store/API/semantic changes: every action, handler and wire path is
 * identical to the pre-refactor editor; only layout moved.
 */
export function SceneEditor({ loadDemoScene }: SceneEditorProps = {}) {
  const objects = useDomainSceneStore((s) => s.objects)
  const locations = useDomainSceneStore((s) => s.locations)
  const tools = useDomainSceneStore((s) => s.tools)
  const homePose = useDomainSceneStore((s) => s.homePose)
  const robot = useDomainSceneStore((s) => s.robot)
  const addObject = useDomainSceneStore((s) => s.addObject)
  const removeObject = useDomainSceneStore((s) => s.removeObject)
  const updateObject = useDomainSceneStore((s) => s.updateObject)
  const addLocation = useDomainSceneStore((s) => s.addLocation)
  const removeLocation = useDomainSceneStore((s) => s.removeLocation)
  const updateLocation = useDomainSceneStore((s) => s.updateLocation)
  const addTool = useDomainSceneStore((s) => s.addTool)
  const removeTool = useDomainSceneStore((s) => s.removeTool)
  const setHomePose = useDomainSceneStore((s) => s.setHomePose)
  const approachHeight = useDomainSceneStore((s) => s.approachHeight)
  const setApproachHeight = useDomainSceneStore((s) => s.setApproachHeight)
  const loadSceneFile = useDomainSceneStore((s) => s.loadSceneFile)

  /** D12 local file IO: [Load Scene] reads a SceneFile from disk and hydrates
   *  the store; [Save Scene] downloads the serialized SceneFile. */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const handleLoadClick = () => {
    if (loadDemoScene) {
      // Demo-API path (Slice 4 wires the real client): fetch → same action.
      loadDemoScene()
        .then((file) => {
          loadSceneFile(file)
          setFileError(null)
        })
        .catch((err) =>
          setFileError(err instanceof Error ? err.message : 'Failed to load demo scene'),
        )
      return
    }
    fileInputRef.current?.click()
  }

  const handleSceneFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      // Shallow structural guard — the backend does the authoritative
      // tier (a)/(b) validation on the server side.
      if (!isSceneFile(parsed)) {
        throw new Error('Not a valid SceneFile v1 document')
      }
      loadSceneFile(parsed)
      setFileError(null)
    } catch (err) {
      setFileError(
        `Invalid scene file: ${err instanceof Error ? err.message : 'unknown error'}`,
      )
    } finally {
      // Allow re-selecting the same file to re-trigger change.
      e.target.value = ''
    }
  }

  const handleSaveClick = () => {
    const file = useDomainSceneStore.getState().serializeSceneFile()
    downloadTextFile('scene.json', JSON.stringify(file, null, 2), 'application/json')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* D12 IO toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <button
          onClick={handleLoadClick}
          className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
        >
          Load Scene
        </button>
        <button
          onClick={handleSaveClick}
          className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
        >
          Save Scene
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Load scene file"
          onChange={handleSceneFileChange}
          className="hidden"
        />
        {fileError && (
          <p role="alert" className="text-xs text-red-400 truncate">
            {fileError}
          </p>
        )}
      </div>

      {/* R1 — accordion: Setup open by default; entity lists collapsed. */}
      <Accordion multiple defaultValue={['setup']} className="w-full overflow-y-auto">
        <AccordionItem value="setup" className="border-b border-border/50">
          <AccordionTrigger className="px-3 py-2 pr-2 text-xs font-semibold text-foreground uppercase tracking-wider hover:no-underline hover:bg-accent/40 cursor-pointer [&>svg]:text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
            Setup
          </AccordionTrigger>
          <AccordionContent>
            <SetupSection
              robot={robot}
              homePose={homePose}
              setHomePose={setHomePose}
              approachHeight={approachHeight}
              setApproachHeight={setApproachHeight}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="objects" className="border-b border-border/50">
          <AccordionTrigger className="px-3 py-2 pr-2 text-xs font-semibold text-foreground uppercase tracking-wider hover:no-underline hover:bg-accent/40 cursor-pointer [&>svg]:text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
            Objects
          </AccordionTrigger>
          <AccordionContent>
            <ObjectsSection
              objects={objects}
              addObject={addObject}
              removeObject={removeObject}
              updateObject={updateObject}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="locations" className="border-b border-border/50">
          <AccordionTrigger className="px-3 py-2 pr-2 text-xs font-semibold text-foreground uppercase tracking-wider hover:no-underline hover:bg-accent/40 cursor-pointer [&>svg]:text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
            Locations
          </AccordionTrigger>
          <AccordionContent>
            <LocationsSection
              locations={locations}
              addLocation={addLocation}
              removeLocation={removeLocation}
              updateLocation={updateLocation}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="tools" className="border-b border-border/50">
          <AccordionTrigger className="px-3 py-2 pr-2 text-xs font-semibold text-foreground uppercase tracking-wider hover:no-underline hover:bg-accent/40 cursor-pointer [&>svg]:text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
            Tools
          </AccordionTrigger>
          <AccordionContent>
            <ToolsSection
              tools={tools}
              addTool={addTool}
              removeTool={removeTool}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
