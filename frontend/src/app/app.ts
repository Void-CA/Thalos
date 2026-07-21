import { Component, computed, effect, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { NgIcon } from '@ng-icons/core';
import { SceneViewer } from './features/scene/components/scene-viewer/scene-viewer';
import { RobotCatalog } from './features/robots/components/robot-catalog/robot-catalog';
import { TopBar } from './shared/components/top-bar/top-bar';
import { BottomPanel } from './shared/components/bottom-panel/bottom-panel';
import { Splitter } from './shared/components/splitter/splitter';
import { StatusBar } from './shared/components/status-bar/status-bar';
import { SessionBrowser } from './shared/components/session-browser/session-browser';
import { PerspectiveStore } from './shared/store/perspective.store';
import { LayoutStore } from './shared/store/layout.store';
import { SceneStore } from './features/scene/store/scene.store';
import { LogStore } from './shared/store/log.store';
import { PlanningStore } from './shared/store/planning.store';
import { AnalysisWorkspace } from './features/plan-analysis/workspace/analysis-workspace';
import { PlanningWorkspace } from './features/planning/workspace/planning-workspace';

/**
 * Layout shell — compone paneles según la perspectiva activa.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NgComponentOutlet,
    NgIcon,
    SceneViewer,
    RobotCatalog,
    SessionBrowser,
    TopBar,
    BottomPanel,
    Splitter,
    StatusBar,
    AnalysisWorkspace,
    PlanningWorkspace,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly perspective = inject(PerspectiveStore);
  protected readonly layout = inject(LayoutStore);
  private readonly scene = inject(SceneStore);
  private readonly log = inject(LogStore);

  /** Watch for errors in SceneStore and push to LogStore. */
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

  protected readonly leftPanelTitle = computed(() => {
    const content = this.perspective.leftPanelContent();
    return content === 'sessions' ? 'Sessions' : 'Robots';
  });

  protected readonly hasRightPanel = computed(() => {
    return this.perspective.rightPanel().length > 0;
  });

  protected readonly isAnalysisMode = computed(() => {
    return this.perspective.perspective() === 'analysis';
  });

  protected readonly isPlanningMode = computed(() => {
    return this.perspective.perspective() === 'planning';
  });

  protected readonly isLegacyMode = computed(() => {
    return !this.isAnalysisMode() && !this.isPlanningMode();
  });

  // ── Active robot info ──

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
