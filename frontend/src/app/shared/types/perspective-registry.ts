import { Type } from '@angular/core';
import { JointControl } from '../../features/scene/components/joint-control/joint-control';
import { IkTargetPanel } from '../../features/scene/components/ik-target-panel/ik-target-panel';
import { TcpInfoPanel } from '../../features/scene/components/tcp-info-panel/tcp-info-panel';
import { WorkspacePanel } from '../../features/workspace/components/workspace-panel/workspace-panel';
import { PlanningPanel } from '../../features/planning/planning-panel';
import { TrajectoryColorPicker } from '../../features/planning/trajectory-color-picker';
import { AlternativesPanel } from '../../features/plan-analysis/components/alternatives-panel';
import { ExecutionCharts } from '../../features/execution/execution-charts';
import { ExecutionPanel } from '../../features/execution/execution-panel';
import type { Perspective, PerspectiveConfig, ToolSchema } from './perspective';

/**
 * Registry central de configuraciones por perspectiva.
 *
 * Define qué paneles se muestran y qué contenido tienen.
 * Cada perspectiva representa una actividad del usuario, no un modo abstracto.
 */
export const PERSPECTIVE_REGISTRY: Record<Perspective, PerspectiveConfig> = {
  robot: {
    showLeftPanel: true,
    showBottomPanel: false,
    leftPanelContent: 'robots',
    rightPanel: [
      { id: 'fk', label: 'Forward Kinematics', component: JointControl, defaultOpen: true },
      { id: 'ik', label: 'Inverse Kinematics', component: IkTargetPanel, defaultOpen: true },
      { id: 'workspace', label: 'Workspace Analysis', component: WorkspacePanel, defaultOpen: false },
      { id: 'tcp', label: 'Active TCP', component: TcpInfoPanel, defaultOpen: false },
    ],
    bottomTabs: [],
  },

  planning: {
    showLeftPanel: true,
    showBottomPanel: true,
    leftPanelContent: 'robots',
    rightPanel: [
      { id: 'color', label: 'Trajectory Color', component: TrajectoryColorPicker, defaultOpen: true },
      { id: 'planning', label: 'Motion Planning', component: PlanningPanel as Type<unknown>, defaultOpen: true },
      { id: 'alternatives', label: 'Alternatives', component: AlternativesPanel, defaultOpen: false },
    ],
    bottomTabs: [
      { id: 'plan-analysis', label: 'Analysis', icon: 'heroClipboardDocumentCheck', component: undefined as unknown as Type<unknown> },
    ],
  },

  execution: {
    showLeftPanel: false,
    showBottomPanel: true,
    rightPanel: [
      { id: 'execution', label: 'Active Plan', component: ExecutionPanel, defaultOpen: true },
      { id: 'charts', label: 'Telemetry', component: ExecutionCharts, defaultOpen: false },
    ],
    bottomTabs: [
      { id: 'timeline', label: 'Timeline', icon: 'heroClock', component: undefined as unknown as Type<unknown> },
      { id: 'log', label: 'Log', icon: 'heroDocumentText', component: undefined as unknown as Type<unknown> },
    ],
  },

  sessions: {
    showLeftPanel: true,
    showBottomPanel: false,
    leftPanelContent: 'sessions',
    rightPanel: [
      { id: 'execution', label: 'Active Plan', component: ExecutionPanel, defaultOpen: true },
    ],
    bottomTabs: [],
  },
};

/** Labels para la top bar. */
export const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  robot: 'Robot',
  planning: 'Planning',
  execution: 'Execution',
  sessions: 'Sessions',
};

/** Íconos para la top bar. */
export const PERSPECTIVE_ICONS: Record<Perspective, string> = {
  robot: 'heroAdjustmentsVertical',
  planning: 'heroClipboardDocumentList',
  execution: 'heroPlay',
  sessions: 'heroClock',
};
