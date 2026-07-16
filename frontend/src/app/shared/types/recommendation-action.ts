// ── Domain-level action types for recommendations ──
//
// A RecommendationAction represents WHAT a recommendation wants to do,
// not HOW it's done in the UI. The ActionDispatcher translates these
// into FocusRequests + mode switches + panel navigation.

/**
 * Types of actions a recommendation can trigger.
 */
export type RecommendationAction =
  | { type: 'focus-waypoint'; waypoint: number }
  | { type: 'open-ik-settings' }
  | { type: 'open-speed-settings' }
  | { type: 'open-waypoint-editor'; waypoint?: number }
  | { type: 'open-constraint-editor'; constraint?: string }
  | { type: 'open-tool-frame-settings' }
  | { type: 'open-scene-editor' }
  | { type: 'select-ik-solution' };

/**
 * Map a SuggestionKind string to a RecommendationAction.
 */
export function suggestionKindToAction(kind: string, waypoint?: number | null): RecommendationAction {
  switch (kind) {
    case 'manipulability':
    case 'ik_solution':
      return { type: 'select-ik-solution' };
    case 'singularity':
      return { type: 'open-ik-settings' };
    case 'velocity':
      return { type: 'open-speed-settings' };
    case 'collision':
      return waypoint != null
        ? { type: 'focus-waypoint', waypoint }
        : { type: 'open-scene-editor' };
    case 'waypoint':
      return { type: 'open-waypoint-editor', waypoint: waypoint ?? undefined };
    case 'constraint':
      return { type: 'open-constraint-editor' };
    default:
      return waypoint != null
        ? { type: 'focus-waypoint', waypoint }
        : { type: 'open-ik-settings' };
  }
}
