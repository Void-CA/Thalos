import { Component, computed, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { NgIcon } from '@ng-icons/core';
import { SceneViewer } from './features/scene/components/scene-viewer/scene-viewer';
import { RobotCatalog } from './features/robots/components/robot-catalog/robot-catalog';
import { TopBar } from './shared/components/top-bar/top-bar';
import { BottomPanel } from './shared/components/bottom-panel/bottom-panel';
import { Splitter } from './shared/components/splitter/splitter';
import { StatusBar } from './shared/components/status-bar/status-bar';
import { ModeStore } from './shared/store/mode.store';
import { LayoutStore } from './shared/store/layout.store';
import { UI_MODE_REGISTRY } from './shared/types/ui-mode-registry';
import type { ToolSchema } from './shared/types/tool-schema';

/**
 * Layout shell — compone las 6 zonas del layout redimensionable.
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  Top Bar — mode + system status                     │
 * ├──────┬──────────┬──────────────────┬──────────┬──────┤
 * │ LEFT │  split   │     CENTER       │  split   │RIGHT │
 * │robot │          │   3D Renderer    │          │Tools │
 * │catalog│         │   (Three.js)     │          │ctx   │
 * ├──────┴──────────┴──────────────────┴──────────┴──────┤
 * │ split (horizontal)                                    │
 * ├──────────────────────────────────────────────────────┤
 * │  Bottom Panel — tabs [Snapshot][Timeline][Log]        │
 * ├──────────────────────────────────────────────────────┤
 * │  Status Bar — Sim · Robot · Exec · ⚠ · 14:32         │
 * └──────────────────────────────────────────────────────┘
 *
 * Right panel es schema-driven via UI_MODE_REGISTRY.
 * Layout persiste tamaño/colapso en localStorage.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NgComponentOutlet,
    NgIcon,
    SceneViewer,
    RobotCatalog,
    TopBar,
    BottomPanel,
    Splitter,
    StatusBar,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly modeStore = inject(ModeStore);
  protected readonly layout = inject(LayoutStore);

  protected readonly currentTools = computed<readonly ToolSchema[]>(
    () => UI_MODE_REGISTRY[this.modeStore.mode()],
  );
}
