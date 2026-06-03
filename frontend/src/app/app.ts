import { Component } from '@angular/core';
import { SceneViewer } from './features/scene/components/scene-viewer/scene-viewer';
import { JointControl } from './features/scene/components/joint-control/joint-control';
import { RobotCatalog } from './features/robots/components/robot-catalog/robot-catalog';

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
  imports: [SceneViewer, JointControl, RobotCatalog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
