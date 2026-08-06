import type { ComponentType } from 'react'
import { FkPanel } from './fk-panel'
import { IkPanel } from './ik-panel'
import { WorkspacePanel } from './workspace-panel'
import { TcpPanel } from './tcp-panel'

export interface ToolDef {
  id: string
  label: string
  component: ComponentType
}

/**
 * Registry de tools por perspectiva.
 *
 * Matching Angular (perspective-registry.ts):
 *   robot → FK, IK, Workspace, TCP
 *
 * Sin `defaultOpen`: el accordion arranca con todos los paneles cerrados
 * (product-quality item 6 — Base UI ya es single-open por defecto).
 */
export const TOOLS_BY_PERSPECTIVE: Record<string, ToolDef[]> = {
  robot: [
    { id: 'fk', label: 'Forward Kinematics', component: FkPanel },
    { id: 'ik', label: 'Inverse Kinematics', component: IkPanel },
    { id: 'workspace', label: 'Workspace Analysis', component: WorkspacePanel },
    { id: 'tcp', label: 'Active TCP', component: TcpPanel },
  ],
  sessions: [],
  planning: [],
  execution: [],
  knowledge: [],
}
