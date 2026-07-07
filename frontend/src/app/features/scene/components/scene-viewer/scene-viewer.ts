import { AfterViewInit, Component, computed, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
import { TrajectoryOverlayService } from '../../renderer/trajectory-overlay.service';
import { IkTargetOverlayService } from '../../renderer/ik-target-overlay.service';
import { PointCloudOverlayService } from '../../renderer/point-cloud-overlay.service';
import { WorkspaceStore } from '../../../workspace/store/workspace.store';
import { ModeStore } from '../../../../shared/store/mode.store';
import { rotationDtoToQuaternion } from '../../utils/rotation';

/**
 * Contenedor Three.js que renderiza la escena robótica con overlays
 * contextuales según el modo activo (ModeStore).
 *
 * Reacciona al SceneStore.state via effect() — sin subscriptions manuales.
 * Los effects están separados por responsabilidad:
 *   1. Escena (data) — solo cuando cambia la geometría
 *   2. Trayectoria (activePlan) — solo en planning / execution
 *   3. Gizmo IK (ikTarget) — solo en analysis / planning
 *   4. Transforms (liveTransforms) — cada tick, frames + links
 *   5. Point cloud (workspace) — solo en analysis
 *
 * Componente PURO de renderizado: no monta paneles de control.
 * El panel IK vive en el sidebar de la app (ver app.html).
 */
@Component({
  selector: 'scene-viewer',
  standalone: true,
  template: `
    <canvas #canvas></canvas>

    <!-- Viewport toolbar -->
    <div class="viewport-toolbar">
      <button
        class="toolbar-btn"
        (click)="onFitRobot()"
        [disabled]="hasData() === false"
        title="Fit Robot"
      >Fit Robot</button>
    </div>
  `,
  styleUrl: './scene-viewer.scss',
})
export class SceneViewer implements AfterViewInit {
  @ViewChild('canvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly store = inject(SceneStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly modeStore = inject(ModeStore);
  private readonly renderer = inject(ThreeRendererService);
  private readonly pointCloud = inject(PointCloudOverlayService);
  private readonly trajectoryOverlay = inject(TrajectoryOverlayService);
  private readonly ikTargetOverlay = inject(IkTargetOverlayService);

  private sceneApplied = false;

  /** True when the scene has renderable robot data. */
  protected readonly hasData = computed(() => this.store.state().data !== null);

  /**
   * Computeds que aíslan propiedades específicas del state.
   *
   * Angular `effect()` trackea a nivel de señal: si `state` emite un nuevo objeto,
   * todos los effects que lean `state()` se re-ejecutan, aunque la propiedad
   * concreta que les interesa tenga la misma referencia.
   *
   * `computed()` en cambio cachea su valor de retorno y solo notifica a dependientes
   * cuando éste cambia por referencia. Esto evita que effects como `syncTrajectory`
   * corran en cada tick de ejecución o en cada movimiento de FK.
   */
  private readonly sceneData = computed(() => this.store.state().data);
  private readonly activePlan = computed(() => this.store.state().activePlan);

  constructor() {
    // Effect 1: scene geometry — solo cuando cambia la escena (load, IK, URDF import)
    effect(() => {
      const data = this.sceneData();
      if (data) {
        this.renderer.applyScene(data);
        this.sceneApplied = true;
      }
    });

    // Effect 2: trajectory overlay — solo en planning / execution
    effect(() => {
      const plan = this.activePlan();
      const mode = this.modeStore.mode();
      const vis = plan?.visualization;
      const segs = plan?.segments;
      if ((mode === 'planning' || mode === 'execution') && vis && vis.waypoints.length > 0) {
        this.trajectoryOverlay.syncTrajectory(vis.waypoints, vis.motionType, segs ?? undefined);
      } else {
        this.trajectoryOverlay.clearTrajectory();
      }
    });

    // Effect 3: IK gizmo — solo en analysis / planning
    effect(() => {
      const target = this.store.state().ikTarget;
      const mode = this.modeStore.mode();
      if ((mode === 'analysis' || mode === 'planning') && target) {
        const quat = target.rotation
          ? rotationDtoToQuaternion(target.rotation)
          : undefined;
        this.ikTargetOverlay.setTarget(target.translation, quat);
      } else {
        this.ikTargetOverlay.clearTarget();
      }
    });

    // Effect 4: runtime delta — transforms de frames + links (cada tick)
    effect(() => {
      const transforms = this.store.state().liveTransforms;
      if (this.sceneApplied && transforms.length > 0) {
        this.renderer.syncTransforms(transforms);
      }
    });

    // Effect 5: point cloud overlay layers — solo en analysis.
    // Maneja tres capas independientes: base, manipulabilidad, singularidad.
    effect(() => {
      if (this.modeStore.mode() !== 'analysis') {
        this.pointCloud.clear();
        return;
      }

      // Layer 1: Base cloud (monochrome orange)
      const baseData = this.workspace.pointCloud();
      const showBase = this.workspace.showBaseCloud();
      if (baseData && showBase) {
        this.pointCloud.setBaseCloud(baseData);
      } else {
        this.pointCloud.clearBase();
      }
      this.pointCloud.showBase(showBase && !!baseData);

      // Layer 2: Manipulability (Yoshikawa gradient)
      const manip = this.workspace.manipulability();
      const showManip = this.workspace.showManipulability();
      if (manip && showManip) {
        this.pointCloud.setManipulabilityCloud(manip.points);
      } else {
        this.pointCloud.clearManipulability();
      }
      this.pointCloud.showManipulability(showManip && !!manip);

      // Layer 3: Singularity (state colors)
      const sing = this.workspace.singularity();
      const showSing = this.workspace.showSingularity();
      if (sing && showSing) {
        this.pointCloud.setSingularityCloud(sing.points);
      } else {
        this.pointCloud.clearSingularity();
      }
      this.pointCloud.showSingularity(showSing && !!sing);
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
    this.renderer.registerOverlay(this.pointCloud);
    this.renderer.registerOverlay(this.trajectoryOverlay);
    this.renderer.registerOverlay(this.ikTargetOverlay);
  }

  /** Frame the robot in the viewport. */
  protected onFitRobot(): void {
    const data = this.store.state().data;
    if (data) {
      this.renderer.fitToView(data);
    }
  }


}
