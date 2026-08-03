//! Scoring policy — deterministic penalty configuration and the derived
//! `quality_index` / `grade` mapping (spec `analysis-score-semantics`).
//!
//! The policy is intentionally SEPARATE from the aggregator (design C2):
//! [`DefaultAggregator`](crate::analysis::aggregator::DefaultAggregator) only
//! knows the [`ScoringPolicy`] trait, never concrete weights. Concrete weight
//! values evolve with operational experience without touching the spec or the
//! observation model.
//!
//! # Score semantics (spec `analysis-score-semantics`)
//!
//! - `quality_index` is determined SOLELY by the report's observations.
//! - Penalties are deterministic and configured by the policy; the default
//!   implementation defines standard weights that MAY evolve (policy
//!   evolution) without changing the semantics below.
//! - `quality_index` lives in `[0, 1]`; the wire DTO projects `× 100` in a
//!   later phase (PR 7a), never here.
//! - Grade mapping: Excellent ≥ 0.9, Good ≥ 0.7, Fair ≥ 0.5, Poor < 0.5
//!   (deterministic, thresholds inclusive).
//!
//! # Monotonicity (D6)
//!
//! `quality = max(0, 1 − Σ penalty_i)` with every `penalty_i ≥ 0`. Additive,
//! non-negative penalties guarantee `Obs ⊆ Obs' ⇒ quality(Obs') ≤ quality(Obs)`
//! — proven by property tests in CI, never by runtime asserts (closed decision).

use crate::analysis::observation::{Observation, Severity};
use crate::analysis::summary::Grade;

/// Deterministic penalty and quality configuration (design C2).
///
/// Implementations define `penalty(severity)`; `quality_index` and `grade_for`
/// are derived from it and inherited unchanged.
pub trait ScoringPolicy {
    /// Penalty weight for a severity. MUST be `>= 0` (D6 monotonicity proof).
    fn penalty(&self, severity: Severity) -> f64;

    /// The aggregate quality index of a set of observations: `max(0, 1 − Σ
    /// penalty_i)` (D6).
    ///
    /// Penalties are summed **per severity in canonical order** (Info, Warning,
    /// Error), never per observation in input order. Floating-point addition is
    /// not associative, so an order-sensitive sum could vary by ulps between
    /// runs; the canonical-order sum is exactly independent of the input order
    /// — this is what makes `quality_index` deterministic AND commutative at
    /// the `f64` level.
    fn quality_index(&self, observations: &[Observation]) -> f64 {
        let mut counts = [0usize; 3]; // [Info, Warning, Error]
        for observation in observations {
            match observation.severity {
                Severity::Info => counts[0] += 1,
                Severity::Warning => counts[1] += 1,
                Severity::Error => counts[2] += 1,
            }
        }
        let total = counts[0] as f64 * self.penalty(Severity::Info)
            + counts[1] as f64 * self.penalty(Severity::Warning)
            + counts[2] as f64 * self.penalty(Severity::Error);
        (1.0 - total).max(0.0)
    }

    /// Deterministic grade mapping (spec `analysis-score-semantics`).
    ///
    /// Thresholds are inclusive: `0.9 → Excellent`, `0.7 → Good`, `0.5 → Fair`,
    /// strictly below `0.5 → Poor`.
    fn grade_for(&self, quality_index: f64) -> Grade {
        match quality_index {
            q if q >= 0.9 => Grade::Excellent,
            q if q >= 0.7 => Grade::Good,
            q if q >= 0.5 => Grade::Fair,
            _ => Grade::Poor,
        }
    }
}

/// Default scoring policy — a reasonable starting point, documented as
/// CONFIGURABLE policy, not a sacred constant (spec: concrete weights MAY
/// evolve). Penalization ordering: Info < Warning < Error.
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultScoringPolicy;

impl DefaultScoringPolicy {
    /// Penalty weight for [`Severity::Info`].
    pub const INFO_PENALTY: f64 = 0.05;
    /// Penalty weight for [`Severity::Warning`].
    pub const WARNING_PENALTY: f64 = 0.15;
    /// Penalty weight for [`Severity::Error`].
    pub const ERROR_PENALTY: f64 = 0.30;
}

impl ScoringPolicy for DefaultScoringPolicy {
    fn penalty(&self, severity: Severity) -> f64 {
        // Exhaustive match (no wildcard): `Severity` is defined in this crate,
        // so adding a severity breaks compilation here until the policy assigns
        // it a weight — no silent zero-penalty default.
        match severity {
            Severity::Info => Self::INFO_PENALTY,
            Severity::Warning => Self::WARNING_PENALTY,
            Severity::Error => Self::ERROR_PENALTY,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{DefaultScoringPolicy, ScoringPolicy};
    use crate::analysis::location::Location;
    use crate::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use crate::analysis::summary::Grade;
    use crate::ids::MotionPlanId;
    use std::collections::BTreeMap;

    fn observation(severity: Severity) -> Observation {
        Observation {
            id: ObservationId(0), // incoming ids are ignored by the aggregator
            kind: ObservationKind::ResidualError,
            severity,
            artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
            location: Location::Waypoint(0),
            attributes: BTreeMap::new(),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    #[test]
    fn grade_boundaries_map_to_grades() {
        // Spec analysis-score-semantics "Grade boundaries": [0.95, 0.75, 0.55,
        // 0.30] → [Excellent, Good, Fair, Poor]. Weight-independent: the mapping
        // is a pure function of quality_index.
        let policy = DefaultScoringPolicy;
        let cases = [
            (0.95, Grade::Excellent),
            (0.75, Grade::Good),
            (0.55, Grade::Fair),
            (0.30, Grade::Poor),
        ];
        for (index, expected) in cases {
            assert_eq!(policy.grade_for(index), expected, "grade_for({index})");
        }
    }

    #[test]
    fn grade_boundary_value_09_is_excellent() {
        // Spec "Boundary value": 0.9 → Excellent (>= 0.9, inclusive).
        let policy = DefaultScoringPolicy;
        assert_eq!(policy.grade_for(0.9), Grade::Excellent);
    }

    #[test]
    fn grade_inclusive_lower_boundaries() {
        // Triangulation: every threshold is inclusive (>=), so 0.7 → Good and
        // 0.5 → Fair; only values strictly below 0.5 are Poor.
        let policy = DefaultScoringPolicy;
        assert_eq!(policy.grade_for(0.7), Grade::Good);
        assert_eq!(policy.grade_for(0.5), Grade::Fair);
        assert_eq!(policy.grade_for(0.49), Grade::Poor);
        assert_eq!(policy.grade_for(0.0), Grade::Poor);
    }

    #[test]
    fn zero_observations_produce_perfect_quality() {
        // Spec "Observations drive quality": zero observations → 1.0.
        let policy = DefaultScoringPolicy;
        assert_eq!(policy.quality_index(&[]), 1.0);
    }

    #[test]
    fn quality_is_one_minus_total_penalty() {
        // D6: quality = max(0, 1 - Σ penalty_i). Expected values are derived
        // from policy.penalty(...) so the test survives weight evolution.
        // The two expressions associate the float additions differently
        // (impl: 1 - (pE + pW + pI); test: (1 - pE) - pW - pI), which can
        // differ by one ulp — compare with tolerance, asserting semantics.
        let policy = DefaultScoringPolicy;
        let error = observation(Severity::Error);
        let warning = observation(Severity::Warning);
        let info = observation(Severity::Info);
        let expected = 1.0
            - policy.penalty(Severity::Error)
            - policy.penalty(Severity::Warning)
            - policy.penalty(Severity::Info);
        let actual = policy.quality_index(&[error, warning, info]);
        assert!(
            (actual - expected).abs() < 1e-12,
            "quality_index {actual} must equal 1 - Σ penalties ≈ {expected}"
        );
    }

    #[test]
    fn quality_clamps_at_zero_when_penalties_exceed_one() {
        // D6: the max(0, ·) floor — a saturated artifact cannot go negative.
        let policy = DefaultScoringPolicy;
        let errors_per_penalty = policy.penalty(Severity::Error);
        let n = (1.0 / errors_per_penalty) as usize + 2;
        let saturated: Vec<_> = (0..n).map(|_| observation(Severity::Error)).collect();
        assert_eq!(policy.quality_index(&saturated), 0.0);
    }

    #[test]
    fn penalty_increases_with_severity_and_is_non_negative() {
        // Penalization ordering (PR 2a): Info < Warning < Error, each >= 0 so
        // the D6 additive-penalty monotonicity proof holds.
        let policy = DefaultScoringPolicy;
        let info = policy.penalty(Severity::Info);
        let warning = policy.penalty(Severity::Warning);
        let error = policy.penalty(Severity::Error);
        assert!(info >= 0.0 && warning >= 0.0 && error >= 0.0);
        assert!(info < warning && warning < error);
    }
}
