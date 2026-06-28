import { AfterViewInit, Component, computed, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
import { WorkspaceOverlayService } from '../../services/workspace-overlay.service';
import { WorkspaceStore } from '../../../workspace/store/workspace.store';
import { rotationDtoToQuaternion } from '../../utils/rotation';

/**
 * Contenedor Three.js que renderiza la escena robótica + gizmo IK.
 *
 * Reacciona al SceneStore.state via effect() — sin subscriptions manuales.
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

  /** True when the scene has renderable robot data. */
  protected readonly hasData = computed(() => this.store.state().data !== null);

  constructor() {
    // Sync robot scene + IK gizmo + trajectory overlay
    effect(() => {
      const state = this.store.state();
      if (state.data) {
        this.renderer.applyScene(state.data);
      }
      // IK gizmo — rotation is in wire format (RotationDto), Three.js wants
      // a quaternion tuple. Convert at the boundary, not in the renderer.
      if (state.ikTarget) {
        const quat = state.ikTarget.rotation
          ? rotationDtoToQuaternion(state.ikTarget.rotation)
          : undefined;
        this.renderer.setTarget(state.ikTarget.translation, quat);
      } else {
        this.renderer.clearTarget();
      }
      // Trajectory overlay — waypoints + motion type + optional segment info
      const vis = state.activePlan?.visualization;
      const segs = state.activePlan?.segments;
      if (vis && vis.waypoints.length > 0) {
        this.renderer.syncTrajectory(vis.waypoints, vis.motionType, segs ?? undefined);
      } else {
        this.renderer.clearTrajectory();
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
