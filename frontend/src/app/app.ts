import { Component, computed, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { SceneViewer } from './features/scene/components/scene-viewer/scene-viewer';
import { RobotCatalog } from './features/robots/components/robot-catalog/robot-catalog';
import { TopBar } from './shared/components/top-bar/top-bar';
import { BottomPanel } from './shared/components/bottom-panel/bottom-panel';
import { AiObservabilityPanel } from './shared/components/ai-observability-panel/ai-observability-panel';
import { NotificationHost } from './shared/components/notification-host/notification-host';
import { ModeStore } from './shared/store/mode.store';
import { UI_MODE_REGISTRY } from './shared/types/ui-mode-registry';
import type { ToolSchema } from './shared/types/tool-schema';

/**
 * Layout shell — compone las 5 zonas del "control panel".
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
 *
 * Panel derecho NO hardcodea tools — consume `UI_MODE_REGISTRY`.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NgComponentOutlet,
    SceneViewer,
    RobotCatalog,
    TopBar,
    BottomPanel,
    AiObservabilityPanel,
    NotificationHost,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly modeStore = inject(ModeStore);
  protected readonly currentTools = computed<readonly ToolSchema[]>(
    () => UI_MODE_REGISTRY[this.modeStore.mode()],
  );
}
