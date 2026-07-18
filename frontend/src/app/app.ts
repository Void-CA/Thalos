import { Component, computed, effect, inject } from '@angular/core';
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
import { SceneStore } from './features/scene/store/scene.store';
import { LogStore } from './shared/store/log.store';
import { PlanningStore } from './shared/store/planning.store';
import { KeyboardShortcutService } from './shared/services/keyboard-shortcut.service';
import { UI_MODE_REGISTRY } from './shared/types/ui-mode-registry';
import type { ToolSchema } from './shared/types/tool-schema';

/**
 * Layout shell — compone las 6 zonas del layout redimensionable.
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
  protected readonly scene = inject(SceneStore);
  private readonly log = inject(LogStore);

  /** Activate global keyboard shortcuts. */
  private readonly keyboard = inject(KeyboardShortcutService);

  /** Watch for errors in SceneStore and push to LogStore, deduplicated. */
  private lastError: string | null = null;
  private readonly errorSignal = computed(() => this.scene.state().ui?.error ?? null);
  private readonly errorWatcher = effect(() => {
    const error = this.errorSignal();
    if (error && error !== this.lastError) {
      this.lastError = error;
      this.log.error(error);
    } else if (!error) {
      this.lastError = null;
    }
  });

  /** Clear the motion program when switching robots */
  private readonly planStore = inject(PlanningStore);
  private lastRobotId: string | null = null;
  private readonly robotWatcher = effect(() => {
    const robotId = this.scene.state()?.runtime?.robot?.id ?? null;
    if (this.lastRobotId !== null && robotId !== this.lastRobotId) {
      this.planStore.clear();
      this.log.info('Plan cleared — robot changed');
    }
    this.lastRobotId = robotId;
  });

  protected readonly currentTools = computed<readonly ToolSchema[]>(
    () => UI_MODE_REGISTRY[this.modeStore.mode()],
  );

  // ── Active robot info (for left panel) ──

  protected readonly activeRobot = computed(() => {
    const state = this.scene.state();
    const rt = state?.runtime;
    if (!rt?.robot) return null;

    return {
      name: rt.robot.display_name,
      dof: rt.robot.dof,
      joints: rt.robot.joints,
      values: rt.joints,
    };
  });

  protected readonly jointLabels = computed(() => {
    const robot = this.activeRobot();
    if (!robot) return [];
    return robot.joints.map((j, i) => ({
      label: j.name,
      value: robot.values[i] ?? 0,
    }));
  });
}
