import { AfterViewInit, Component, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
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
  `,
  styleUrl: './scene-viewer.scss',
})
export class SceneViewer implements AfterViewInit {
  @ViewChild('canvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly store = inject(SceneStore);
  private readonly renderer = inject(ThreeRendererService);

  constructor() {
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
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
  }
}
