import { AfterViewInit, Component, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
import { IkTargetPanel } from '../ik-target-panel/ik-target-panel';

/**
 * Contenedor Three.js que renderiza la escena robótica + gizmo IK.
 *
 * Reacciona al SceneStore.state via effect() — sin subscriptions manuales.
 */
@Component({
  selector: 'scene-viewer',
  standalone: true,
  imports: [IkTargetPanel],
  template: `
    <canvas #canvas></canvas>
    <ik-target-panel class="ik-overlay" />
  `,
  styles: [
    `
    :host { display: block; width: 100%; height: 100%; position: relative; }
    canvas { display: block; width: 100%; height: 100%; }
    .ik-overlay {
      position: absolute;
      bottom: 1rem;
      right: 1rem;
      width: 220px;
      background: rgba(20, 20, 20, 0.92);
      border: 1px solid #444;
      border-radius: 6px;
      padding: 0.75rem;
      color: #ccc;
    }
  `,
  ],
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
      // IK gizmo
      if (state.ikTarget) {
        this.renderer.setTarget(state.ikTarget.translation, state.ikTarget.rotation);
      } else {
        this.renderer.clearTarget();
      }
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
  }
}
