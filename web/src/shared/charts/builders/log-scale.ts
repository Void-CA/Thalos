/**
 * Singularity-safe log-scale transform for manipulability metrics (hotfix
 * manipulability-logscale).
 *
 * Both charted metrics — yoshikawa and det(J·Jᵀ) = ∏σᵢ² — are ALWAYS >= 0 and
 * span many orders of magnitude across a real trajectory (measured at runtime:
 * yoshikawa max/min ~60,000×, det max/min ~3.6×10⁹×). A linear y axis flattens
 * the low end against zero, which made the chart look like a single flat
 * observation. -log10 spreads those decades evenly: a value approaching zero
 * (near-singularity) becomes a LARGE value, so real variation is visible.
 *
 * Floor decision (documented): exact zero (or a negative, which should never
 * happen) maps to `floor` (default 6.0) instead of null. Null drops the point
 * from the chart and loses the singularity signal; a floor keeps it as a spike
 * at the top edge. Singularity IS the signal this chart exists to show.
 */
export function toLogScale(value: number, floor = 6): number {
  if (value <= 0) return floor
  return -Math.log10(value) + 0
}
