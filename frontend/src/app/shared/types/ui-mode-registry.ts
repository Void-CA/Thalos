import { Type } from '@angular/core';
import type { AppMode } from './app-mode';
import type { ToolSchema } from './tool-schema';
import { JointControl } from '../../features/scene/components/joint-control/joint-control';
import { IkTargetPanel } from '../../features/scene/components/ik-target-panel/ik-target-panel';
import { WorkspacePanel } from '../../features/workspace/components/workspace-panel/workspace-panel';
import { PlanningPanel } from '../../features/planning/planning-panel';
import { WaypointsPanel } from '../../features/planning/waypoints-panel';
import { PlanManagementPanel } from '../../features/planning/plan-management-panel';
import { ExecutionPanel } from '../../features/execution/execution-panel';
import { ChartsSignalsPanel } from '../../features/execution/charts-signals-panel';

/**
 * Registry central de tools por modo.
 *
 * Regla:
 *   - Agregar un tool = agregar entrada al schema
 *   - El layout NO cambia
 *   - El panel derecho solo hace render(schema, context)
 *
 * Cada mode define sus tools como array de ToolSchema.
 * El componente de cada tool es un standalone component Angular.
 */
export const UI_MODE_REGISTRY: Record<AppMode, readonly ToolSchema[]> = {
  analysis: [
    { id: 'fk', label: 'Forward Kinematics', component: JointControl, defaultOpen: true },
    { id: 'ik', label: 'Inverse Kinematics', component: IkTargetPanel, defaultOpen: true },
    { id: 'workspace', label: 'Workspace Analysis', component: WorkspacePanel, defaultOpen: false },
  ],
  planning: [
    { id: 'planning', label: 'Motion Planning', component: PlanningPanel as Type<unknown>, defaultOpen: true },
    { id: 'waypoints', label: 'Waypoints', component: WaypointsPanel as Type<unknown>, defaultOpen: false },
    { id: 'plan-management', label: 'Plan Management', component: PlanManagementPanel as Type<unknown>, defaultOpen: false },
  ],
  execution: [
    { id: 'execution', label: 'Active Plan', component: ExecutionPanel, defaultOpen: true },
    { id: 'charts', label: 'Charts & Signals', component: ChartsSignalsPanel, defaultOpen: false },
  ],
} as const;
