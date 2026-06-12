import { Component, inject } from '@angular/core';
import { SceneViewer } from './features/scene/components/scene-viewer/scene-viewer';
import { JointControl } from './features/scene/components/joint-control/joint-control';
import { IkTargetPanel } from './features/scene/components/ik-target-panel/ik-target-panel';
import { RobotCatalog } from './features/robots/components/robot-catalog/robot-catalog';
import { WorkspacePanel } from './features/workspace/components/workspace-panel/workspace-panel';
import { TopBar } from './shared/components/top-bar/top-bar';
import { BottomPanel } from './shared/components/bottom-panel/bottom-panel';
import { PlanningPanel } from './features/planning/planning-panel';
import { ModeStore } from './shared/store/mode.store';

/**
 * Layout shell — solo compone UI.
 *
 * - No llama API
 * - No maneja Three.js
 * - No contiene lógica de estado
 *
 * ┌────────────────────────────────────────────┐
 * │  Top Bar — mode + system status            │
 * ├──────┬─────────────────────┬───────────────┤
 * │ LEFT │      CENTER         │    RIGHT      │
 * │robot │   3D Renderer       │  Tool Context │
 * │catalog│   (Three.js)       │ (per mode)   │
 * ├──────┴─────────────────────┴───────────────┤
 * │  Bottom Panel — System Observability       │
 * └────────────────────────────────────────────┘
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    SceneViewer,
    JointControl,
    IkTargetPanel,
    RobotCatalog,
    WorkspacePanel,
    TopBar,
    BottomPanel,
    PlanningPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly modeStore = inject(ModeStore);
}
