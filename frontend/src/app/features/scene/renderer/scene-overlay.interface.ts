import * as THREE from 'three';

/**
 * Contrato que cualquier overlay de escena debe cumplir.
 *
 * El `ThreeRendererService` llama a `attach()` durante el registro
 * (si el renderer ya fue inicializado) o en cuanto se llame a `init()`.
 */
export interface SceneOverlay {
  attach(scene: THREE.Scene): void;
}
