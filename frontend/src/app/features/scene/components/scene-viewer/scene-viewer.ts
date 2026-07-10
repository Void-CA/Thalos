import { AfterViewInit, Component, computed, effect, ElementRef, inject, signal, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
import { TrajectoryOverlayService } from '../../renderer/trajectory-overlay.service';
import { IkTargetOverlayService } from '../../renderer/ik-target-overlay.service';
import { PointCloudOverlayService } from '../../renderer/point-cloud-overlay.service';
import { WorkspaceStore } from '../../../workspace/store/workspace.store';
import { ModeStore } from '../../../../shared/store/mode.store';
import { PlanningStore } from '../../../planning/planning.store';
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
    <div
      class="drop-zone"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
      (pointerdown)="onPointerDown($event)"
      (pointerup)="onPointerUp($event)"
    >
      <canvas #canvas></canvas>

      @if (isDragOver()) {
        <div class="drop-overlay">
          <span class="drop-overlay-text">Drop Here</span>
        </div>
      }

      @if (store.state().ui.loading) {
        <div class="spinner-overlay">
          <div class="spinner"></div>
        </div>
      }

      @if (dropError(); as err) {
        <div class="drop-toast" (animationend)="dropError.set(null)">
          {{ err }}
        </div>
      }
    </div>

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

  protected readonly store = inject(SceneStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly modeStore = inject(ModeStore);
  private readonly renderer = inject(ThreeRendererService);
  private readonly pointCloud = inject(PointCloudOverlayService);
  private readonly trajectoryOverlay = inject(TrajectoryOverlayService);
  private readonly ikTargetOverlay = inject(IkTargetOverlayService);
  private readonly planningStore = inject(PlanningStore);

  private sceneApplied = false;

  /** Drag-and-drop state signals. */
  protected readonly isDragOver = signal(false);
  protected readonly dropError = signal<string | null>(null);
  private lastDropTs = 0;

  /** True when the scene has renderable robot data. */
  protected readonly hasData = computed(() => this.store.state().data !== null);

  // ── Waypoint interaction state ──

  private pointerDownPos: { x: number; y: number } | null = null;
  private isWaypointDrag = false;

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

    // Effect 6: store error after drop — forward backend errors to drop toast
    effect(() => {
      const err = this.store.state().ui.error;
      if (err && this.lastDropTs > 0 && Date.now() - this.lastDropTs < 10_000) {
        this.dropError.set(err);
        this.lastDropTs = 0; // consume once
      }
    });

    // Effect 7: sync planning waypoints with 3D scene
    effect(() => {
      const mode = this.modeStore.mode();
      const waypoints = this.planningStore.waypoints();
      const selectedId = this.planningStore.selectedWaypointId();

      if (mode === 'planning' && waypoints.length > 0) {
        this.trajectoryOverlay.syncWaypoints(waypoints, selectedId);
        this.setupDragControls(waypoints);
      } else {
        this.trajectoryOverlay.clearWaypoints();
        this.trajectoryOverlay.disableDragControls();
      }
    });

    // Effect 8: highlight sync when selection changes (independent of waypoint rebuild)
    effect(() => {
      const mode = this.modeStore.mode();
      const selectedId = this.planningStore.selectedWaypointId();
      if (mode === 'planning') {
        this.trajectoryOverlay.highlightWaypoint(selectedId);
      }
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
    this.renderer.registerOverlay(this.pointCloud);
    this.renderer.registerOverlay(this.trajectoryOverlay);
    this.renderer.registerOverlay(this.ikTargetOverlay);
  }

  /** Validate file extension — only .urdf and .xml are accepted. */
  private isUrdfFile(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.endsWith('.urdf') || lower.endsWith('.xml');
  }

  /** Handle dragover: prevent default to allow drop, show overlay. */
  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  /** Handle dragleave: hide overlay. */
  protected onDragLeave(event: DragEvent): void {
    // Only hide when actually leaving the drop zone (not entering a child)
    if (!event.currentTarget || !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
      this.isDragOver.set(false);
    }
  }

  /** Handle drop: validate file, read content, call store pipeline. */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }

    // Find first .urdf or .xml file (R3: single file, first match only)
    let targetFile: File | null = null;
    for (let i = 0; i < files.length; i++) {
      if (this.isUrdfFile(files[i].name)) {
        targetFile = files[i];
        break;
      }
    }

    if (!targetFile) {
      this.dropError.set('Only .urdf/.xml files accepted');
      setTimeout(() => this.dropError.set(null), 4000);
      return;
    }

    // Record drop timestamp for error correlation
    this.lastDropTs = Date.now();

    // Read file as text and call store pipeline
    const reader = new FileReader();
    reader.onload = () => {
      const source = reader.result as string;
      this.store.loadRobotFromUrdf(source);
    };
    reader.onerror = () => {
      this.dropError.set('Failed to read file');
      setTimeout(() => this.dropError.set(null), 4000);
    };
    reader.readAsText(targetFile);
  }

  // ──────────────────────────────────────────────
  // Waypoint 3D interaction
  // ──────────────────────────────────────────────

  /** Track pointer position on down to detect click vs drag. */
  protected onPointerDown(event: PointerEvent): void {
    this.pointerDownPos = { x: event.clientX, y: event.clientY };
  }

  /** On pointer up: detect click (no significant movement) and pick waypoint. */
  protected onPointerUp(event: PointerEvent): void {
    if (!this.pointerDownPos) return;
    const dx = event.clientX - this.pointerDownPos.x;
    const dy = event.clientY - this.pointerDownPos.y;
    this.pointerDownPos = null;

    // Ignore if this was a drag
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) return;
    if (this.isWaypointDrag) return;

    // Only pick waypoints in planning mode
    if (this.modeStore.mode() !== 'planning') return;

    const camera = this.renderer.getCamera();
    const canvas = this.canvasRef.nativeElement;
    if (!camera) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    const id = this.trajectoryOverlay.pickWaypoint(raycaster);
    if (id) {
      this.planningStore.selectWaypoint(id);
    }
  }

  /**
   * Set up DragControls for waypoint spheres.
   * Disables OrbitControls during drag to prevent interference.
   */
  private setupDragControls(waypoints: unknown[]): void {
    if (waypoints.length === 0) return;

    const camera = this.renderer.getCamera();
    const canvas = this.canvasRef.nativeElement;
    if (!camera) return;

    this.trajectoryOverlay.enableDragControls(camera, canvas, {
      onDragStart: () => {
        this.isWaypointDrag = true;
        this.renderer.setOrbitControlsEnabled(false);
      },
      onDrag: (id, position) => {
        this.planningStore.updateWaypointPosition(id, position);
      },
      onDragEnd: (id, position) => {
        this.planningStore.updateWaypointPosition(id, position);
        this.isWaypointDrag = false;
        this.renderer.setOrbitControlsEnabled(true);
      },
    });
  }

  /** Frame the robot in the viewport. */
  protected onFitRobot(): void {
    const data = this.store.state().data;
    if (data) {
      this.renderer.fitToView(data);
    }
  }
}

