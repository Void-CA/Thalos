import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { SceneStore } from '../../services/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';

/**
 * Bridge between the reactive store and the imperative Three.js engine.
 *
 * - Grabs the <canvas> ref via @ViewChild
 * - Subscribes to SceneStore.state$
 * - Forwards every valid scene to ThreeRendererService.applyScene()
 * - Owns the renderer lifecycle (init / dispose)
 *
 * ⚠ applyScene is safe to call before init — ThreeRendererService
 *   silently ignores calls when the engine isn't ready yet.
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
export class SceneViewer implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly store = inject(SceneStore);
  private readonly renderer = inject(ThreeRendererService);
  private readonly sub: Subscription;

  constructor() {
    this.sub = this.store.state$.subscribe(state => {
      if (state.scene) {
        this.renderer.applyScene(state.scene);
      }
    });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.renderer.dispose();
  }
}
