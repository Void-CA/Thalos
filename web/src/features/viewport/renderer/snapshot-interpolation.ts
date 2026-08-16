import * as THREE from 'three'
import type { ObjectTransform } from '../types'

/**
 * Renderer-side temporal interpolation of execution snapshots (PR1 rework).
 *
 * DESIGN — delay buffer (replaces the original pair-window):
 *
 * The original PR1 interpolated toward the snapshot that had JUST arrived
 * (`now >= currTs` because `receivedAt` is stamped before `useFrame` runs on
 * the same render-clock timeline) — the alpha was always 1 in production, so
 * interpolation never produced an intermediate pose. The fix is to NOT
 * interpolate toward the freshest snapshot: the renderer deliberately renders
 * a time window BEHIND the last received tick.
 *
 *   renderTime = performance.now() - INTERPOLATION_DELAY_MS
 *
 * Each RobotModel instance keeps a rolling buffer of the last N snapshots
 * (`SNAPSHOT_BUFFER_CAPACITY`). Every frame it locates the pair straddling
 * `renderTime` (`buffer[i].receivedAt <= renderTime < buffer[i+1].receivedAt`)
 * and interpolates that pair — with jitter there may be several snapshots
 * already received behind `renderTime`, so the window is searched, never
 * assumed to be the two latest entries.
 *
 * VISUAL LATENCY (deliberate): the viewport renders ~INTERPOLATION_DELAY_MS
 * behind the most recent backend state. The robot is NOT "reacting late" —
 * the visual REPRESENTATION carries a temporal buffer; it is the price of
 * interpolating without extrapolating.
 *
 *   backend authoritative → store (receivedAt + history) → renderer (temporal interpolation)
 *
 * Pure helpers, free of R3F/React so they run under plain vitest.
 *
 * KNOWN LIMITATION (accepted): snapshots carry world-space transforms of frames
 * and links independently, so interpolating them is not a rigid-body solve —
 * adjacent links can drift slightly off joint pivots mid-tick. This is a
 * deliberate visual-only tradeoff; FK is never recomputed in the renderer.
 */

/**
 * Visual-latency policy constant (ms): the fixed temporal offset between the
 * freshest backend state and the pose the viewport renders. A fixed policy
 * knob, NEVER derived from `dt` — decoupled from Simulation's tick semantics.
 */
export const INTERPOLATION_DELAY_MS = 80

/**
 * Rolling buffer capacity per RobotModel instance.
 *
 * INVARIANT — the interpolation window
 * `buffer[i].receivedAt <= renderTime < buffer[i+1].receivedAt` only exists
 * while the OLDEST buffered snapshot still predates `renderTime`. The tick
 * loop cadence (rAF + local HTTP await in execution-store.ts) is ~17–27ms, so
 * the delay window reaches back `INTERPOLATION_DELAY_MS / tickGap` ticks; the
 * buffer must span that many snapshots PLUS one pair member. With a smaller
 * capacity the fast regime would always fall back to the oldest pose (alpha 0,
 * per-tick snapping — the same no-op symptom as the original PR1).
 *
 *   capacity >= ceil(INTERPOLATION_DELAY_MS / MIN_EXPECTED_TICK_GAP_MS) + 1
 *   capacity >= ceil(80 / 17) + 1 = 6      (MIN_EXPECTED_TICK_GAP_MS = 17ms)
 *
 * 8 adds jitter margin over that theoretical minimum.
 */
export const SNAPSHOT_BUFFER_CAPACITY = 8

/** An execution snapshot as consumed by the interpolator. */
export interface RuntimeSnapshot {
  transforms: ObjectTransform[]
  receivedAt: number
}

/** Interpolation window: the previous and the current snapshot. */
export interface SnapshotPair {
  prev: RuntimeSnapshot
  current: RuntimeSnapshot
}

/** Rolling buffer of recent snapshots, oldest first, newest last. */
export type SnapshotBuffer = RuntimeSnapshot[]

/**
 * Push a newly arrived snapshot into the buffer, dropping the oldest entry
 * once the capacity is exceeded. Idempotent on `receivedAt`: the SAME buffer
 * reference is returned when a duplicate arrives, so per-frame calls in the
 * render loop are allocation-free between real ticks. Returns a fresh buffer
 * (immutable) only when a genuinely new snapshot is inserted.
 */
export function pushSnapshot(buffer: SnapshotBuffer, next: RuntimeSnapshot): SnapshotBuffer {
  const last = buffer[buffer.length - 1]
  if (last && last.receivedAt === next.receivedAt) return buffer
  if (buffer.length < SNAPSHOT_BUFFER_CAPACITY) return [...buffer, next]
  return [...buffer.slice(1), next]
}

/**
 * Find the pair of snapshots straddling `renderTime`:
 * `buffer[i].receivedAt <= renderTime < buffer[i+1].receivedAt`.
 *
 * Edge cases:
 * - Fewer than two snapshots → null (no window yet; caller holds the pose).
 * - `renderTime >= last receivedAt` → null (HOLD latest — never extrapolate).
 * - `renderTime < oldest receivedAt` → the OLDEST pair, whose alpha clamps to
 *   0 in `computeAlpha`, i.e. the oldest exact pose.
 */
export function findInterpolationWindow(buffer: SnapshotBuffer, renderTime: number): SnapshotPair | null {
  if (buffer.length < 2) return null
  const last = buffer[buffer.length - 1]
  if (renderTime >= last.receivedAt) return null
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i].receivedAt <= renderTime && renderTime < buffer[i + 1].receivedAt) {
      return { prev: buffer[i], current: buffer[i + 1] }
    }
  }
  // renderTime is behind the oldest buffered snapshot → clamp to the oldest pair.
  return { prev: buffer[0], current: buffer[1] }
}

/**
 * Interpolation factor for `renderTime` between two snapshot timestamps.
 * - `prevTs === currTs` → 1 (no division by zero).
 * - `renderTime >= currTs` → 1 (hold, never extrapolate past the latest snapshot).
 * - `renderTime <= prevTs` → 0 (clamped — the division would go negative).
 * - otherwise `(renderTime - prevTs) / (currTs - prevTs)` clamped to [0, 1].
 */
export function computeAlpha(renderTime: number, prevTs: number, currTs: number): number {
  if (prevTs === currTs) return 1
  if (renderTime >= currTs) return 1
  if (renderTime <= prevTs) return 0
  return Math.min(1, Math.max(0, (renderTime - prevTs) / (currTs - prevTs)))
}

/**
 * Interpolate every transform id of `current` toward `prev` by the SAME alpha.
 * - position: linear lerp.
 * - rotation: quaternion slerp ([w,x,y,z] wire order), never naive lerp.
 * - scale: linear lerp (`scale.y` encodes link cylinder length).
 * - an id missing from `prev` is emitted as-is from `current` (no warp).
 * Returns a fresh array; input snapshots are never mutated.
 */
export function interpolateTransforms(prev: RuntimeSnapshot, current: RuntimeSnapshot, alpha: number): ObjectTransform[] {
  const prevById = new Map<string, ObjectTransform>()
  for (const tx of prev.transforms) prevById.set(tx.id, tx)
  return current.transforms.map((tx) => {
    const p = prevById.get(tx.id)
    if (!p) return { ...tx }
    return {
      id: tx.id,
      translation: lerpVec3(p.translation, tx.translation, alpha),
      rotation: slerpQuat(p.rotation, tx.rotation, alpha),
      scale: lerpVec3(p.scale, tx.scale, alpha),
    }
  })
}

function lerpVec3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

// Module-level scratch quaternions: slerp mutates its target, so reuse avoids
// per-transform allocations in the render loop. Both are always re-seeded
// before use (below), so no cross-call aliasing.
const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()

/** Slerp between wire-order [w,x,y,z] quaternions, returning [w,x,y,z]. */
function slerpQuat(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  _qa.set(a[1], a[2], a[3], a[0])
  _qb.set(b[1], b[2], b[3], b[0])
  _qa.slerp(_qb, t)
  return [_qa.w, _qa.x, _qa.y, _qa.z]
}
