import type { ComponentType } from 'react'
import { FkPanel } from './fk-panel'
import { IkPanel } from './ik-panel'
import { TcpPanel } from './tcp-panel'
import { WorkspaceAnalysis } from '@/features/workspace-analysis/components/workspace-analysis'

export interface ToolDef {
  id: string
  label: string
  component: ComponentType
}

/**
 * Registry de tools por perspectiva.
 *
 * Matching Angular (perspective-registry.ts):
 *   robot → FK, IK, TCP, Workspace Analysis
 *
 * Workspace Analysis lives HERE as an accordion tool (P0-B reorg): the Robot
 * view is layout 'panel', so the 3D viewport stays mounted and the feature's
 * point-cloud color controls re-color the cloud in real time. It owns the
 * point-cloud color controls — the old WorkspacePanel duplicate is gone.
 * No /analysis route: the report renders inline in the accordion.
 *
 * Sin `defaultOpen`: el accordion arranca con todos los paneles cerrados
 * (product-quality item 6 — Base UI ya es single-open por defecto).
 */
export const TOOLS_BY_PERSPECTIVE: Record<string, ToolDef[]> = {
  robot: [
    { id: 'fk', label: 'Forward Kinematics', component: FkPanel },
    { id: 'ik', label: 'Inverse Kinematics', component: IkPanel },
    { id: 'tcp', label: 'Active TCP', component: TcpPanel },
    { id: 'workspace-analysis', label: 'Workspace Analysis', component: WorkspaceAnalysis },
  ],
  sessions: [],
  planning: [],
  execution: [],
  knowledge: [],
}
