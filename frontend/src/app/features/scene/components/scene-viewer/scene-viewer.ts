import { AfterViewInit, Component, computed, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
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
  imports: [NgIcon],
  template: `
    <canvas #canvas></canvas>

    @if (!hasData()) {
      <div class="viewport-empty">
        <div class="viewport-empty__content">
          <ng-icon name="heroCpuChip" size="32" />
          <p class="viewport-empty__title">No robot loaded</p>
          <p class="viewport-empty__hint">Select a robot from the catalog or import a URDF file</p>
        </div>
      </div>
    }

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
  private readonly ikTarget = computed(() => this.store.state().ikTarget);
  private readonly liveTransforms = computed(() => this.store.state().liveTransforms);
  private readonly activeTcp = computed(() => this.store.state().activeTcp);

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
        this.renderer.syncTrajectory(vis.waypoints, vis.motionType, segs ?? undefined);
      } else {
        this.renderer.clearTrajectory();
      }
    });

    // Effect 3: IK gizmo — solo reacciona cuando cambia ikTarget (no todo el state)
    effect(() => {
      const target = this.ikTarget();
      if (target) {
        const quat = target.rotation
          ? rotationDtoToQuaternion(target.rotation)
          : undefined;
        this.renderer.setTarget(target.translation, quat);
      } else {
        this.renderer.clearTarget();
      }
    });

    // Effect 4: runtime delta — solo reacciona cuando cambia liveTransforms
    effect(() => {
      const transforms = this.liveTransforms();
      if (this.sceneApplied && transforms.length > 0) {
        this.renderer.syncTransforms(transforms);
      }
    });

    // Effect 5: TCP gizmo — reacciona cuando cambia activeTcp o liveTransforms
    effect(() => {
      const tcp = this.activeTcp();
      const transforms = this.liveTransforms();
      
      if (!tcp) {
        this.renderer.clearTcp();
        return;
      }

      // Find the base frame in transforms
      const frameId = String(tcp.baseFrameId);
      const frameTransform = transforms.find(t => t.id === frameId);
      
      if (frameTransform) {
        // Apply offset to the frame's position
        const position: [number, number, number] = [
          frameTransform.translation[0] + (tcp.offset?.[0] ?? 0),
          frameTransform.translation[1] + (tcp.offset?.[1] ?? 0),
          frameTransform.translation[2] + (tcp.offset?.[2] ?? 0),
        ];
        this.renderer.setTcp(position, frameTransform.rotation);
      } else {
        this.renderer.clearTcp();
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

    // Wire IK target drag → store update
    this.renderer.setOnTargetDrag((pos) => {
      const prev = this.store.state().ikTarget;
      if (prev) {
        this.store.updateTarget({ ...prev, translation: pos });
      }
    });
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
