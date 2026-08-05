import type { ComponentType } from 'react'
import { FkPanel } from './fk-panel'
import { IkPanel } from './ik-panel'
import { WorkspacePanel } from './workspace-panel'
import { TcpPanel } from './tcp-panel'

export interface ToolDef {
  id: string
  label: string
  component: ComponentType
  defaultOpen: boolean
}

/**
 * Registry de tools por perspectiva.
 *
 * Matching Angular (perspective-registry.ts):
 *   robot → FK, IK, Workspace, TCP
 */
export const TOOLS_BY_PERSPECTIVE: Record<string, ToolDef[]> = {
  robot: [
    { id: 'fk', label: 'Forward Kinematics', component: FkPanel, defaultOpen: true },
    { id: 'ik', label: 'Inverse Kinematics', component: IkPanel, defaultOpen: true },
    { id: 'workspace', label: 'Workspace Analysis', component: WorkspacePanel, defaultOpen: false },
    { id: 'tcp', label: 'Active TCP', component: TcpPanel, defaultOpen: true },
  ],
  sessions: [],
  planning: [],
  analysis: [],
  execution: [],
  knowledge: [],
}
