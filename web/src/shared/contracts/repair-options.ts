/**
 * Canonical repair-options contract — projection of the backend
 * `RepairOptionsResponse` (`POST /plan/repair/options`). This is the ONLY wire
 * shape the frontend consumes for repair options (spec alternatives-panel-react:
 * "the response shape SHALL be RepairOptionsResponse { repairs: Vec<RepairOptionDto> }").
 *
 * The deprecated `POST /plan/analyze/alternatives` (AlternativesResponse) has
 * been removed from the api client (criteria C1/C2 — no dual compatibility, no
 * dead routes).
 */

/** Metrics summary attached to a repair option (manipulability + smoothness). */
export interface RepairMetricsSummaryWire {
  manipulability: number
  smoothness: number
}

/** One repair option as the backend projects it (repair/dto.rs RepairOptionDto). */
export interface RepairOptionWire {
  region_id: number
  /** Stable kebab-case strategy key (e.g. "lift-tcp"), from StrategyKind::name(). */
  strategy: string
  status: string
  /** Improvement fraction (e.g. 0.15); positive = better than the original plan. */
  improvement: number
  metrics_before: RepairMetricsSummaryWire | null
  metrics_after: RepairMetricsSummaryWire | null
}

/** The canonical /plan/repair/options wire payload. */
export interface RepairOptionsWire {
  repairs: RepairOptionWire[]
}
