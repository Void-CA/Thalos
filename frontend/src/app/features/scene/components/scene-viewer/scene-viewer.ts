import { AfterViewInit, Component, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';

/**
 * Contenedor Three.js que renderiza la escena robótica.
 *
 * Reacciona al SceneStore.state via effect() — sin subscriptions manuales.
 */
@Component({
  selector: 'scene-viewer',
  standalone: true,
  template: '<canvas #canvas></canvas>',
  styles: [
    `
    :host { display: block; width: 100%; height: 100%; }
    canvas { display: block; width: 100%; height: 100%; }
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
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
  }
}
