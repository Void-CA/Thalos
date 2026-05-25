// ── Mirror de tipos Rust (thalos-visual/src/scene/mod.rs) ──

export interface VisualFrame {
  id: string;
  parent: string | null;
  translation: [number, number, number];    // [x, y, z] — world-frame
  rotation: [number, number, number, number]; // [w, x, y, z] — unit quaternion
}

export interface VisualLink {
  start: [number, number, number];
  end: [number, number, number];
}

export interface VisualJointAxis {
  origin: [number, number, number];
  axis: [number, number, number];
}

export interface VisualTwist {
  origin: [number, number, number];
  linear: [number, number, number];
  angular: [number, number, number];
}

export interface VisualScene {
  frames: VisualFrame[];
  links: VisualLink[];
  joint_axes: VisualJointAxis[];
  twists: VisualTwist[];
}

export interface SceneResponse {
  scene: VisualScene;
  generated_at: string;
}

export interface SceneState {
  scene: VisualScene | null;
  error: string | null;
}
