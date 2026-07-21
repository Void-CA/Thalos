import { Type } from '@angular/core';
import type { AppMode } from './app-mode';
import type { ToolSchema } from './tool-schema';
import { JointControl } from '../../features/scene/components/joint-control/joint-control';
import { IkTargetPanel } from '../../features/scene/components/ik-target-panel/ik-target-panel';
import { TcpInfoPanel } from '../../features/scene/components/tcp-info-panel/tcp-info-panel';
import { WorkspacePanel } from '../../features/workspace/components/workspace-panel/workspace-panel';
import { PlanningPanel } from '../../features/planning/planning-panel';
import { TrajectoryColorPicker } from '../../features/planning/trajectory-color-picker';
import { AlternativesPanel } from '../../features/plan-analysis/components/alternatives-panel';
import { ExecutionCharts } from '../../features/execution/execution-charts';
import { ExecutionPanel } from '../../features/execution/execution-panel';
import { ExplainPanel } from '../../features/assistant/components/explain-panel/explain-panel';
import { OptimizePanel } from '../../features/assistant/components/optimize-panel/optimize-panel';
import { LearnPanel } from '../../features/assistant/components/learn-panel/learn-panel';
import { AdaptPanel } from '../../features/assistant/components/adapt-panel/adapt-panel';

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
  robot: [
    { id: 'fk', label: 'Forward Kinematics', component: JointControl, defaultOpen: true },
    { id: 'ik', label: 'Inverse Kinematics', component: IkTargetPanel, defaultOpen: true },
    { id: 'learn', label: 'Learn', component: LearnPanel, defaultOpen: false },
    { id: 'workspace', label: 'Workspace Analysis', component: WorkspacePanel, defaultOpen: false },
    { id: 'tcp', label: 'Active TCP', component: TcpInfoPanel, defaultOpen: false },
  ],
  planning: [
    { id: 'color', label: 'Trajectory Color', component: TrajectoryColorPicker, defaultOpen: true },
    { id: 'planning', label: 'Motion Planning', component: PlanningPanel as Type<unknown>, defaultOpen: true },
    { id: 'optimize', label: 'Optimize', component: OptimizePanel, defaultOpen: false },
    { id: 'explain', label: 'Explain', component: ExplainPanel, defaultOpen: false },
    { id: 'alternatives', label: 'Alternatives', component: AlternativesPanel, defaultOpen: false },
  ],
  execution: [
    { id: 'execution', label: 'Active Plan', component: ExecutionPanel, defaultOpen: true },
    { id: 'charts', label: 'Telemetry', component: ExecutionCharts, defaultOpen: false },
    { id: 'adapt', label: 'Adapt', component: AdaptPanel, defaultOpen: false },
  ],
} as const;
