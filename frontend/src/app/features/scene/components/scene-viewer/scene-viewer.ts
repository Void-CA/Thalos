import { AfterViewInit, Component, computed, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
import { TrajectoryOverlayService } from '../../renderer/trajectory-overlay.service';
import { WorkspaceOverlayService } from '../../services/workspace-overlay.service';
import { WorkspaceStore } from '../../../workspace/store/workspace.store';
import { rotationDtoToQuaternion } from '../../utils/rotation';

/**
 * Contenedor Three.js que renderiza la escena robótica + gizmo IK.
 *
 * Reacciona al SceneStore.state via effect() — sin subscriptions manuales.
 * Los effects están separados por responsabilidad:
 *   1. Escena (data) — solo cuando cambia la geometría
 *   2. Trayectoria (activePlan) — solo al compilar/preview
 *   3. Gizmo (ikTarget) — actualización local
 *   4. Transforms (liveTransforms) — cada tick, frames + links
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
  private readonly renderer = inject(ThreeRendererService);
  private readonly overlay = inject(WorkspaceOverlayService);
  private readonly trajectoryOverlay = inject(TrajectoryOverlayService);

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

    // Effect 2: trajectory overlay — solo al compilar/preview (NUNCA en tick)
    effect(() => {
      const plan = this.activePlan();
      const vis = plan?.visualization;
      const segs = plan?.segments;
      if (vis && vis.waypoints.length > 0) {
        this.trajectoryOverlay.syncTrajectory(vis.waypoints, vis.motionType, segs ?? undefined);
      } else {
        this.trajectoryOverlay.clearTrajectory();
      }
    });

    // Effect 3: IK gizmo — actualización local del target
    effect(() => {
      const target = this.store.state().ikTarget;
      if (target) {
        const quat = target.rotation
          ? rotationDtoToQuaternion(target.rotation)
          : undefined;
        this.renderer.setTarget(target.translation, quat);
      } else {
        this.renderer.clearTarget();
      }
    });

    // Effect 4: runtime delta — transforms de frames + links (cada tick)
    effect(() => {
      const transforms = this.store.state().liveTransforms;
      if (this.sceneApplied && transforms.length > 0) {
        this.renderer.syncTransforms(transforms);
      }
    });

    // Sync point cloud overlay from workspace analysis.
    // Priority: manipulability (gradient) > singularity (state colors) > monochrome.
    effect(() => {
      this.syncPointCloudOverlay();
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
    this.renderer.registerOverlay(this.overlay);
    this.renderer.registerOverlay(this.trajectoryOverlay);
    this.syncPointCloudOverlay();
  }

  /** Frame the robot in the viewport. */
  protected onFitRobot(): void {
    const data = this.store.state().data;
    if (data) {
      this.renderer.fitToView(data);
    }
  }

  private syncPointCloudOverlay(): void {
    const manip = this.workspace.manipulability();
    const singularity = this.workspace.singularity();
    const cloud = this.workspace.pointCloud();
    const show = this.workspace.showPointCloud();

    if (manip && show) {
      this.overlay.setGradientPointCloud(manip.points);
    } else if (singularity && show) {
      this.overlay.setColoredPointCloud(singularity.points);
    } else if (cloud && show) {
      this.overlay.setPointCloud(cloud);
    } else {
      this.overlay.clear();
    }
  }
}
