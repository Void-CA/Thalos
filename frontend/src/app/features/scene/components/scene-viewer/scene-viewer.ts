import { AfterViewInit, Component, effect, ElementRef, inject, ViewChild } from '@angular/core';
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

    <!-- Render scale toolbar — presets overlaid on the viewport -->
    <div class="render-scale-bar">
      @for (opt of SCALE_OPTIONS; track opt) {
        <button
          class="scale-btn"
          [class.active]="store.renderScale() === opt"
          (click)="store.setRenderScale(opt)"
        >{{ opt }}x</button>
      }
    </div>
  `,
  styleUrl: './scene-viewer.scss',
})
export class SceneViewer implements AfterViewInit {
  @ViewChild('canvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly store = inject(SceneStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly renderer = inject(ThreeRendererService);
  private readonly overlay = inject(WorkspaceOverlayService);

  /** Render scale presets available in the toolbar. */
  protected readonly SCALE_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

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
      // Trajectory overlay — waypoints + motion type from the active plan
      const vis = state.activePlan?.visualization;
      if (vis && vis.waypoints.length > 0) {
        this.renderer.syncTrajectory(vis.waypoints, vis.motionType);
      } else {
        this.renderer.clearTrajectory();
      }
    });

    // Sync point cloud overlay from workspace analysis.
    // Priority: manipulability (gradient) > singularity (state colors) > monochrome.
    effect(() => {
      this.syncPointCloudOverlay();
    });

    // Sync render scale to the robot group.
    effect(() => {
      this.renderer.setRenderScale(this.store.renderScale());
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);

    this.renderer.registerOverlay(this.overlay);

    this.syncPointCloudOverlay();
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
