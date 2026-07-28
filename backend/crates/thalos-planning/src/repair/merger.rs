//! PlanMerger — aplica un `PlanDelta` a un `CompiledPlan` y produce uno nuevo.
//!
//! Validaciones:
//! - Rango válido dentro del plan original
//! - Continuidad C0: entry y exit waypoints coinciden
//!
//! No modifica el plan original. Devuelve un `CompiledPlan` nuevo.

use crate::motion::program::CompiledPlan;
use crate::repair::domain::types::{PlanDelta, RepairError};

/// Aplica deltas de reparación a planes compilados.
///
/// Crea un nuevo `CompiledPlan` sin mutar el original.
pub struct PlanMerger;

impl PlanMerger {
    /// Aplica un `PlanDelta` a un `CompiledPlan` y devuelve el plan resultante.
    ///
    /// # Errores
    /// - `InvalidDelta`: rango fuera de bounds o vacío
    /// - `ContinuityViolation`: entry/exit no coinciden
    pub fn apply(plan: &CompiledPlan, delta: &PlanDelta) -> Result<CompiledPlan, RepairError> {
        let total = plan.waypoint_count;

        // Validar rango
        if delta.waypoint_range.start >= total || delta.waypoint_range.end > total {
            return Err(RepairError::InvalidDelta(format!(
                "range {:?} out of bounds for plan with {} waypoints",
                delta.waypoint_range, total
            )));
        }
        if delta.waypoint_range.is_empty() {
            return Err(RepairError::InvalidDelta("empty range".into()));
        }

        let original_wps = plan.merged_trajectory.waypoints();
        let replacement_wps = delta.replacement.waypoints();

        // Validar continuidad C0: entry coincide
        if delta.waypoint_range.start > 0 {
            let entry_original = &original_wps[delta.waypoint_range.start];
            let entry_replacement = &replacement_wps[0];
            if !Self::poses_match(entry_original, entry_replacement) {
                return Err(RepairError::ContinuityViolation(
                    "entry pose mismatch".into(),
                ));
            }
        }

        // Validar continuidad C0: exit coincide
        if delta.waypoint_range.end < total {
            let exit_original = &original_wps[delta.waypoint_range.end - 1];
            let exit_replacement = &replacement_wps[replacement_wps.len() - 1];
            if !Self::poses_match(exit_original, exit_replacement) {
                return Err(RepairError::ContinuityViolation(
                    "exit pose mismatch".into(),
                ));
            }
        }

        // Construir nueva trayectoria: prefijo + reemplazo + sufijo
        let mut new_waypoints = Vec::new();
        new_waypoints.extend_from_slice(&original_wps[..delta.waypoint_range.start]);
        new_waypoints.extend_from_slice(replacement_wps);
        new_waypoints.extend_from_slice(&original_wps[delta.waypoint_range.end..]);

        let new_trajectory = thalos_core::trajectory::Trajectory::new(new_waypoints);

        Ok(CompiledPlan::new(new_trajectory, plan.segments.clone()))
    }

    /// Compara dos waypoints para continuidad C0 (posición articular).
    fn poses_match(
        a: &thalos_core::trajectory::TrajectoryPoint,
        b: &thalos_core::trajectory::TrajectoryPoint,
    ) -> bool {
        a.joints().len() == b.joints().len()
            && a.joints()
                .iter()
                .zip(b.joints())
                .all(|(x, y)| (x - y).abs() < 1e-6)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::RegionId;
    use thalos_core::trajectory::{Trajectory, TrajectoryPoint};

    fn make_plan(n: usize) -> CompiledPlan {
        let points: Vec<TrajectoryPoint> = (0..n)
            .map(|i| TrajectoryPoint::new(vec![i as f64], i as f64))
            .collect();
        CompiledPlan::new(Trajectory::new(points), vec![])
    }

    fn make_delta(region_id: RegionId, range: std::ops::Range<usize>, values: &[f64]) -> PlanDelta {
        let points: Vec<TrajectoryPoint> = values
            .iter()
            .enumerate()
            .map(|(i, &v)| TrajectoryPoint::new(vec![v], range.start as f64 + i as f64))
            .collect();
        PlanDelta::new(region_id, range, Trajectory::new(points)).unwrap()
    }

    #[test]
    fn test_valid_replacement_preserves_prefix() {
        let plan = make_plan(20);
        // Reemplazar waypoints 5..10 con valores iguales (misma C0)
        let delta = make_delta(RegionId(0), 5..10, &[5.0, 6.0, 7.0, 8.0, 9.0]);
        let new_plan = PlanMerger::apply(&plan, &delta).unwrap();
        // Prefijo: waypoints 0..4 deben ser iguales
        let wps = new_plan.merged_trajectory.waypoints();
        assert_eq!(wps[0].joints()[0], 0.0);
        assert_eq!(wps[4].joints()[0], 4.0);
        // Reemplazo: waypoints 5..9
        assert_eq!(wps[5].joints()[0], 5.0);
        assert_eq!(wps[9].joints()[0], 9.0);
        // Sufijo: waypoint 10 debe ser el original
        assert_eq!(wps[10].joints()[0], 10.0);
        assert_eq!(wps.len(), 20);
    }

    #[test]
    fn test_invalid_range_fails() {
        let plan = make_plan(10);
        let delta = make_delta(RegionId(0), 5..15, &[5.0; 10]);
        let result = PlanMerger::apply(&plan, &delta);
        assert!(result.is_err());
        match result {
            Err(RepairError::InvalidDelta(_)) => {} // expected
            _ => panic!("Expected InvalidDelta"),
        }
    }

    #[test]
    fn test_discontinuity_fails() {
        let plan = make_plan(20);
        // Reemplazar waypoints 5..10 con valores DIFERENTES
        let delta = make_delta(RegionId(0), 5..10, &[99.0, 99.0, 99.0, 99.0, 99.0]);
        let result = PlanMerger::apply(&plan, &delta);
        assert!(result.is_err());
        match result {
            Err(RepairError::ContinuityViolation(_)) => {} // expected
            other => panic!("Expected ContinuityViolation, got {:?}", other),
        }
    }
}
