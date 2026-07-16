// ── Pure semantic event types for focus/navigation ──
//
// These types have NO dependency on Three.js, Angular, or any rendering library.
// They represent "what to focus on" — the SceneViewer decides HOW.
//
// The AnalysisPanel emits FocusRequests. The SceneViewer consumes them.
// No direct coupling between the two.

/**
 * What kind of thing to focus on.
 */
export type FocusTarget =
  | { type: 'waypoint'; index: number }
  | { type: 'joint'; index: number }
  | { type: 'link'; id: number }
  | { type: 'obstacle'; id: number }
  | { type: 'constraint'; id: string }
  | { type: 'pose'; position: [number, number, number] }
  | { type: 'finding'; kind: string; waypoint?: number | null };

/**
 * How strongly to emphasize the target.
 */
export type FocusEmphasis = 'subtle' | 'normal' | 'strong';

/**
 * A request to focus the viewport on a specific element.
 *
 * Emitted by panels (AnalysisPanel, etc.) and consumed by the SceneViewer.
 * The SceneViewer translates this into camera movement + highlighting.
 */
export interface FocusRequest {
  target: FocusTarget;
  emphasis?: FocusEmphasis;
  /** Optional label to show in a tooltip or HUD. */
  label?: string;
}
