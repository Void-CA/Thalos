import { Component } from '@angular/core';
import { SceneViewer } from './components/scene-viewer/scene-viewer';
import { JointControl } from './components/joint-control/joint-control';

/**
 * Layout shell — solo compone UI.
 *
 * - No llama API
 * - No maneja Three.js
 * - No contiene lógica de estado
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SceneViewer, JointControl],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
