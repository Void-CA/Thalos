import { describe, expect, it } from 'vitest'
import {
  INTERPOLATION_DELAY_MS,
  SNAPSHOT_BUFFER_CAPACITY,
  pushSnapshot,
  findInterpolationWindow,
  computeAlpha,
  interpolateTransforms,
} from './snapshot-interpolation'
import type { RuntimeSnapshot, SnapshotBuffer } from './snapshot-interpolation'
import type { ObjectTransform } from '../types'

/**
 * Renderer-side temporal delay-buffer interpolation (PR1 rework) — pure
 * helpers, no R3F.
 *
 * The original pair-window design was a NO-OP in production: `receivedAt` is
 * stamped in the store before `useFrame` runs, so `now >= currTs` always and
 * `computeAlpha` returned 1 — no intermediate pose was ever produced. The
 * rework renders a window BEHIND the freshest snapshot (`renderTime =
 * performance.now() - INTERPOLATION_DELAY_MS`) and searches a rolling buffer
 * instead of assuming the last pair.
 *
 * - R1: computeAlpha clamps — prevTs===currTs→1, renderTime>=currTs→1,
 *   renderTime<=prevTs→0, exact midpoints in between.
 * - R2: pushSnapshot keeps capacity, drops the oldest, idempotent on receivedAt.
 * - R3: findInterpolationWindow searches the buffer (jitter: several snapshots
 *   may already sit behind renderTime).
 * - R4: renderTime >= last → null (hold latest, never extrapolate).
 * - R5: renderTime <= first → oldest pair, alpha clamps to 0.
 * - R6: interpolateTransforms — position lerp, rotation slerp, scale lerp,
 *   id-only-in-current as-is, inputs never mutated, SAME alpha for all ids.
 * - LIVE: a real arrival-then-render sequence yields an INTERMEDIATE pose
 *   (0 < alpha < 1), which the old tests could never reach.
 */

function tx(id: string, overrides: Partial<ObjectTransform> = {}): ObjectTransform {
  return { id, translation: [0, 0, 0], rotation: [1, 0, 0, 0], scale: [1, 1, 1], ...overrides }
}

function snap(receivedAt: number, ...transforms: ObjectTransform[]): RuntimeSnapshot {
  return { receivedAt, transforms }
}

describe('INTERPOLATION_DELAY_MS — explicit visual-latency policy', () => {
  it('is a fixed exported constant, never derived from dt', () => {
    expect(INTERPOLATION_DELAY_MS).toBe(80)
  })
})

describe('SNAPSHOT_BUFFER_CAPACITY — delay-window invariant', () => {
  // The WARNING this property locks in: with capacity 4 the window
  // `buffer[i].receivedAt <= renderTime < buffer[i+1].receivedAt` only exists
  // when `(capacity-1) * tickGap >= DELAY`. The tick loop's minimum expected
  // cadence (rAF + local HTTP) is 17ms, so the capacity must span
  // ceil(80/17) + 1 = 6 snapshots for the fast regime to ever interpolate.
  it('covers ceil(INTERPOLATION_DELAY_MS / 17) + 1 snapshots at the minimum tick gap', () => {
    // Mirrors the production docstring: MIN_EXPECTED_TICK_GAP_MS = 17.
    const MIN_EXPECTED_TICK_GAP_MS = 17
    const minimumCapacity = Math.ceil(INTERPOLATION_DELAY_MS / MIN_EXPECTED_TICK_GAP_MS) + 1
    expect(SNAPSHOT_BUFFER_CAPACITY).toBeGreaterThanOrEqual(minimumCapacity)
    // Sanity: the value asserted is the 6 the review derived from the warning.
    expect(minimumCapacity).toBe(6)
  })
})

describe('computeAlpha', () => {
  it('returns 1 when prevTs === currTs — no division by zero (R1)', () => {
    expect(computeAlpha(500, 100, 100)).toBe(1)
    expect(computeAlpha(0, 0, 0)).toBe(1)
  })

  it('holds at 1 when renderTime >= currTs — never extrapolates (R1)', () => {
    expect(computeAlpha(200, 100, 200)).toBe(1)
    expect(computeAlpha(500, 100, 200)).toBe(1)
  })

  it('clamps safely to 0 when renderTime < prevTs (R1)', () => {
    expect(computeAlpha(50, 100, 200)).toBe(0)
    expect(computeAlpha(0, 100, 200)).toBe(0)
  })

  it('interpolates exactly between the two timestamps (R1)', () => {
    expect(computeAlpha(150, 100, 200)).toBe(0.5)
    expect(computeAlpha(175, 100, 200)).toBe(0.75)
    expect(computeAlpha(100, 100, 200)).toBe(0)
  })
})

describe('pushSnapshot — rolling buffer with explicit identity (R2)', () => {
  it('first snapshot seeds the buffer', () => {
    const buffer = pushSnapshot([], snap(100, tx('a', { translation: [3, 4, 5] })))
    expect(buffer).toHaveLength(1)
    expect(buffer[0].receivedAt).toBe(100)
  })

  it('drops the oldest snapshot once the capacity is exceeded', () => {
    let buffer: SnapshotBuffer = []
    for (let i = 0; i < SNAPSHOT_BUFFER_CAPACITY + 2; i++) {
      buffer = pushSnapshot(buffer, snap(100 + i, tx('a')))
    }
    expect(buffer).toHaveLength(SNAPSHOT_BUFFER_CAPACITY)
    // Only the two oldest (100, 101) evicted; the newest `capacity` fit.
    const retained = Array.from({ length: SNAPSHOT_BUFFER_CAPACITY }, (_, i) => 102 + i)
    expect(buffer.map(s => s.receivedAt)).toEqual(retained)
  })

  it('same receivedAt is idempotent — returns the SAME buffer reference', () => {
    const first = pushSnapshot([], snap(100, tx('a')))
    const dup = pushSnapshot(first, snap(100, tx('a', { translation: [9, 9, 9] })))
    expect(dup).toBe(first)
    expect(first).toHaveLength(1)
  })
})

describe('findInterpolationWindow — searches the buffer, never assumes the last pair (R3)', () => {
  it('returns null with fewer than two snapshots (no window yet)', () => {
    expect(findInterpolationWindow([snap(100, tx('a'))], 150)).toBeNull()
    expect(findInterpolationWindow([], 150)).toBeNull()
  })

  it('picks the pair straddling renderTime when SEVERAL snapshots sit behind it (jitter)', () => {
    // S0/S1 arrive early, then a burst (S2, S3). renderTime sits after S1 but
    // before S2 — the naive "last two pushed" assumption (S2,S3) would be
    // wrong (extrapolation, alpha 1). The buffer search must find (S1,S2).
    const buffer: SnapshotBuffer = [
      snap(100, tx('a', { translation: [0, 0, 0] })),
      snap(130, tx('a', { translation: [1, 0, 0] })),
      snap(400, tx('a', { translation: [2, 0, 0] })),
      snap(420, tx('a', { translation: [3, 0, 0] })),
    ]
    const window = findInterpolationWindow(buffer, 250)
    expect(window).not.toBeNull()
    expect(window!.prev.receivedAt).toBe(130)
    expect(window!.current.receivedAt).toBe(400)
  })

  it('returns null when renderTime >= last receivedAt — hold, never extrapolate (R4)', () => {
    const buffer: SnapshotBuffer = [
      snap(100, tx('a')),
      snap(200, tx('a')),
      snap(300, tx('a')),
    ]
    expect(findInterpolationWindow(buffer, 300)).toBeNull()
    expect(findInterpolationWindow(buffer, 500)).toBeNull()
  })

  it('returns the oldest pair when renderTime is behind the oldest snapshot — alpha clamps to 0 (R5)', () => {
    const buffer: SnapshotBuffer = [
      snap(100, tx('a', { translation: [0, 0, 0] })),
      snap(200, tx('a', { translation: [10, 0, 0] })),
      snap(300, tx('a', { translation: [20, 0, 0] })),
    ]
    const window = findInterpolationWindow(buffer, 50)
    expect(window).not.toBeNull()
    expect(window!.prev.receivedAt).toBe(100)
    expect(window!.current.receivedAt).toBe(200)
    // The window found, alpha is pinned to 0 → exact oldest pose.
    expect(computeAlpha(50, window!.prev.receivedAt, window!.current.receivedAt)).toBe(0)
  })
})

describe('interpolateTransforms', () => {
  it('lerps position linearly (R6)', () => {
    const prev = snap(0, tx('a', { translation: [0, 0, 0] }))
    const curr = snap(1, tx('a', { translation: [10, 20, 30] }))
    const out = interpolateTransforms(prev, curr, 0.25)
    expect(out[0].translation).toEqual([2.5, 5, 7.5])
  })

  it('slerps rotation — 0°→90° about Y at alpha 0.5 is exactly 45°, not a naive lerp (R6)', () => {
    // 90° about Y: THREE (x,y,z,w) = (0, sin45, 0, cos45) → wire [w,x,y,z] = [cos45, 0, sin45, 0]
    const halfTurn: [number, number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2, 0]
    const prev = snap(0, tx('a', { rotation: [1, 0, 0, 0] }))
    const curr = snap(1, tx('a', { rotation: halfTurn }))
    const out = interpolateTransforms(prev, curr, 0.5)
    const [w, x, y, z]: [number, number, number, number] = out[0].rotation
    const a = Math.PI / 8 // 22.5° → wire [cos22.5°, 0, sin22.5°, 0]
    expect(w).toBeCloseTo(Math.cos(a), 6)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(Math.sin(a), 6)
    expect(z).toBeCloseTo(0, 6)
    // The slerp midpoint is unit-length; a naive component lerp midpoint is not.
    expect(w * w + x * x + y * y + z * z).toBeCloseTo(1, 6)
    // Explicit anti-lerp check: naive lerp of the two [w,y] channels differs.
    expect(w).not.toBeCloseTo((1 + Math.SQRT1_2) / 2, 4)
    expect(y).not.toBeCloseTo(Math.SQRT1_2 / 2, 4)
  })

  it('lerps scale — scale.y encodes link cylinder length (R6)', () => {
    const prev = snap(0, tx('link-1', { scale: [1, 1, 1] }))
    const curr = snap(1, tx('link-1', { scale: [1, 2, 1] }))
    const out = interpolateTransforms(prev, curr, 0.5)
    expect(out[0].scale).toEqual([1, 1.5, 1])
  })

  it('uses an id present only in current as-is — no warp from nothing (R6)', () => {
    const prev = snap(0, tx('frame-1', { translation: [0, 0, 0] }))
    const curr = snap(1, tx('frame-1', { translation: [5, 0, 0] }), tx('link-1', { translation: [7, 7, 7] }))
    const out = interpolateTransforms(prev, curr, 0.5)
    const frame = out.find(t => t.id === 'frame-1')!
    const link = out.find(t => t.id === 'link-1')!
    expect(frame.translation).toEqual([2.5, 0, 0])
    expect(link.translation).toEqual([7, 7, 7])
  })

  it('applies the SAME alpha to frames and links (R6)', () => {
    const prev = snap(0, tx('frame-1', { translation: [0, 0, 0] }), tx('link-1', { translation: [0, 4, 0] }))
    const curr = snap(1, tx('frame-1', { translation: [10, 0, 0] }), tx('link-1', { translation: [0, 4, 8] }))
    const out = interpolateTransforms(prev, curr, 0.5)
    const frame = out.find(t => t.id === 'frame-1')!
    const link = out.find(t => t.id === 'link-1')!
    expect(frame.translation).toEqual([5, 0, 0])
    expect(link.translation).toEqual([0, 4, 4])
  })

  it('never mutates the input snapshots', () => {
    const prevTx = tx('a', { translation: [0, 0, 0], rotation: [1, 0, 0, 0] })
    const currTx = tx('a', { translation: [10, 0, 0], rotation: [0, 0, 1, 0] })
    const prev = snap(0, prevTx)
    const curr = snap(1, currTx)
    interpolateTransforms(prev, curr, 0.5)
    expect(prev.transforms[0]).toEqual(prevTx)
    expect(curr.transforms[0]).toEqual(currTx)
  })
})

describe('LIVE LOOP — the exact production order the old design missed', () => {
  // Reproduces the real sequence WITHOUT R3F:
  //   t0: tick 1 arrives → pushSnapshot(S0, receivedAt = t0)
  //   t1: tick 2 arrives → pushSnapshot(S1, receivedAt = t1)
  //   t2: render runs (now = t2, with t2 > t1)
  //       renderTime = t2 - INTERPOLATION_DELAY_MS must fall INSIDE (S0.ts, S1.ts).
  // With S0.ts = 1000, S1.ts = 1100 and now = 1160: renderTime = 1080 → alpha 0.8.
  it('renders an INTERMEDIATE pose — not S0, not S1 (the old algorithm never could)', () => {
    const t0 = 1000
    const t1 = 1100
    const now = 1160 // render runs AFTER tick 2 arrived, as production does
    expect(now).toBeGreaterThan(t1)

    let buffer: SnapshotBuffer = []
    buffer = pushSnapshot(buffer, snap(t0, tx('frame-1', { translation: [0, 0, 0] })))
    buffer = pushSnapshot(buffer, snap(t1, tx('frame-1', { translation: [10, 0, 0] })))

    const renderTime = now - INTERPOLATION_DELAY_MS
    // renderTime must land strictly between the two snapshot timestamps.
    expect(renderTime).toBeGreaterThan(t0)
    expect(renderTime).toBeLessThan(t1)

    const window = findInterpolationWindow(buffer, renderTime)
    expect(window).not.toBeNull()

    const alpha = computeAlpha(renderTime, window!.prev.receivedAt, window!.current.receivedAt)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)

    const pose = interpolateTransforms(window!.prev, window!.current, alpha)
    const x = pose.find(t => t.id === 'frame-1')!.translation[0]
    // Intermediate: strictly between S0's 0 and S1's 10 — NEVER 10 (the old
    // production no-op held the latest tick at alpha 1).
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(10)
    expect(x).toBeCloseTo(8, 6)
  })

  it('holds the latest pose when renderTime has not caught up (alpha 1, no extrapolation)', () => {
    let buffer: SnapshotBuffer = []
    buffer = pushSnapshot(buffer, snap(1000, tx('frame-1', { translation: [0, 0, 0] })))
    buffer = pushSnapshot(buffer, snap(1100, tx('frame-1', { translation: [10, 0, 0] })))

    // now so far ahead that even the delayed renderTime passed the last tick.
    const now = 1500
    const renderTime = now - INTERPOLATION_DELAY_MS // 1420 >= 1100
    expect(findInterpolationWindow(buffer, renderTime)).toBeNull()
    // Caller falls back to the latest complete snapshot.
    const latest = buffer[buffer.length - 1]
    expect(latest.transforms[0].translation).toEqual([10, 0, 0])
  })
})

describe('LIVE LOOP — fast regime at the real 17–20ms tick cadence (closing criterion #2)', () => {
  // The review WARNING: at ~18ms ticks the delay window reaches back
  // 80/18 ≈ 4.4 ticks, so with capacity 4 the oldest retained snapshot was
  // still NEWER than renderTime → permanent fallback to the oldest pose
  // (alpha 0, per-tick snapping). With capacity 8 the buffer keeps all six
  // snapshots below, so renderTime lands INSIDE a real window.
  it('interpolates — not fallback — when ticks arrive every 18ms', () => {
    const t0 = 1000
    const tickGap = 18
    let buffer: SnapshotBuffer = []
    for (let i = 0; i < 6; i++) {
      buffer = pushSnapshot(buffer, snap(t0 + i * tickGap, tx('frame-1', { translation: [i, 0, 0] })))
    }
    // Cadence: S0@1000, S1@1018, S2@1036, S3@1054, S4@1072, S5@1090.
    expect(buffer).toHaveLength(6) // capacity 8 retains them all.

    const now = t0 + 100 // render runs after S5 arrived, as production does
    const renderTime = now - INTERPOLATION_DELAY_MS // 1020 → inside (1018, 1036)

    const window = findInterpolationWindow(buffer, renderTime)
    // A real window exists — NOT the oldest-pair fallback (which with capacity
    // 4 would be (S2@1036, S3@1054) at alpha 0).
    expect(window).not.toBeNull()
    expect(window!.prev.receivedAt).toBe(t0 + tickGap) // S1@1018
    expect(window!.current.receivedAt).toBe(t0 + 2 * tickGap) // S2@1036

    const alpha = computeAlpha(renderTime, window!.prev.receivedAt, window!.current.receivedAt)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)

    const pose = interpolateTransforms(window!.prev, window!.current, alpha)
    const x = pose.find(t => t.id === 'frame-1')!.translation[0]
    // Strictly between S1.x=1 and S2.x=2 — never the oldest retained pose
    // (which the capacity-4 fallback would render at x=2, alpha 0).
    expect(x).toBeGreaterThan(1)
    expect(x).toBeLessThan(2)
    expect(x).toBeCloseTo(1 + 2 / 18, 6)
  })
})

describe('LIVE LOOP — fallback when the delay window exceeds the buffer (insufficient capacity)', () => {
  // The documented fallback must exist and be correct when the invariant IS
  // violated: a small buffer whose oldest snapshot is still newer than
  // renderTime → findInterpolationWindow returns the OLDEST pair and alpha
  // clamps to 0, i.e. the exact oldest pose (never a wrong interpolation).
  it('falls back to the exact oldest pose when the buffer is too small', () => {
    // Simulates a capacity-2 design at ≥80ms gaps: only the two most recent
    // snapshots survive, so the 80ms delay window reaches back past them.
    const buffer: SnapshotBuffer = [
      snap(1000, tx('frame-1', { translation: [0, 0, 0] })),
      snap(1080, tx('frame-1', { translation: [10, 0, 0] })),
    ]
    const renderTime = 950 // behind the oldest retained snapshot (1000)

    const window = findInterpolationWindow(buffer, renderTime)
    expect(window).not.toBeNull()
    expect(window!.prev.receivedAt).toBe(1000)
    expect(window!.current.receivedAt).toBe(1080)

    const alpha = computeAlpha(renderTime, window!.prev.receivedAt, window!.current.receivedAt)
    expect(alpha).toBe(0)

    const pose = interpolateTransforms(window!.prev, window!.current, alpha)
    expect(pose.find(t => t.id === 'frame-1')!.translation[0]).toBe(0) // exact oldest
  })
})
