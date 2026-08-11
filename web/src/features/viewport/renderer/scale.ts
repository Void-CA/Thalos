/**
 * scaleFromRefDim — the shared pure helper for reference-dimension scaling
 * (spec scene-viewport-entities "Overlay Sizes Scale with referenceDimension").
 *
 * All viewport overlay sizes (scene entities, trajectory waypoints, TCP
 * marker, IK gizmo) derive from the scene's `referenceDimension` (greatest
 * origin→frame distance) so they stay proportional on small robots (e.g. the
 * ~0.1–0.3 m icebot demo) instead of being unusably large.
 *
 * FALLBACK CONTRACT: this helper OWNS the fallback. `refDim` of `undefined`
 * or `null` (scene not loaded / absent field) degrades to `1.0`, making the
 * result exactly `baseRatio` — i.e. every current hardcoded size is preserved
 * when no reference dimension is available (backward compatibility, no-op at
 * refDim = 1.0). Components MUST call this helper and MUST NOT inline their
 * own `if refDim` fallback.
 */
export function scaleFromRefDim(refDim: number | undefined | null, baseRatio: number): number {
  return (refDim ?? 1.0) * baseRatio
}
