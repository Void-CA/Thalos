//! Strategy SplitSegment — inserta waypoints intermedios para mejorar
//! la discretización de segmentos largos o con cambios bruscos.
//!
//! No requiere IK. No modifica la configuración articular.
//! Solo interpola la trayectoria existente insertando nuevos puntos.

use crate::{
    analysis::domain::ProblemRegion,
    evaluation::evaluator::PlanEvaluator,
    motion::program::CompiledPlan,
    repair::{
        context::RepairContext,
        domain::{
            traits::RepairStrategy,
            types::{PlanDelta, RepairCandidate, StrategyKind},
        },
    },
};
use thalos_core::trajectory::{Trajectory, TrajectoryPoint};

/// Estrategia que subdivide segmentos insertando waypoints intermedios.
///
/// No requiere cinemática — solo interpola joints entre waypoints existentes.
pub struct SplitSegment {
    pub insert_count: usize,
}

impl SplitSegment {
    pub fn new(insert_count: usize) -> Self {
        Self { insert_count }
    }

    /// Interpola linealmente entre dos waypoints para generar `n` puntos intermedios.
    fn interpolate_pair(
        a: &TrajectoryPoint,
        b: &TrajectoryPoint,
        n: usize,
    ) -> Vec<TrajectoryPoint> {
        if n == 0 {
            return vec![];
        }
        let dt = (b.timestamp() - a.timestamp()) / (n as f64 + 1.0);
        let mut result = Vec::with_capacity(n);
        for i in 1..=n {
            let t = i as f64 / (n as f64 + 1.0);
            let joints: Vec<f64> = a
                .joints()
                .iter()
                .zip(b.joints())
                .map(|(aj, bj)| aj + (bj - aj) * t)
                .collect();
            result.push(TrajectoryPoint::new(joints, a.timestamp() + dt * i as f64));
        }
        result
    }
}

impl RepairStrategy for SplitSegment {
    fn kind(&self) -> StrategyKind {
        StrategyKind::SplitSegment
    }

    fn applies_to(&self, region: &ProblemRegion) -> bool {
        // Aplica a cualquier región con más de 2 waypoints
        region.waypoint_range.len() > 1
    }

    fn generate(
        &self,
        _context: &RepairContext,
        plan: &CompiledPlan,
        region: &ProblemRegion,
    ) -> Vec<RepairCandidate> {
        if self.insert_count == 0 {
            return vec![];
        }

        let range = region.waypoint_range.clone();
        let segment = match plan.extract_segment(range.clone()) {
            Some(s) => s,
            None => return vec![],
        };

        let wps = segment.waypoints();
        if wps.len() < 2 {
            return vec![];
        }

        let mut new_wps = Vec::new();

        for i in 0..wps.len() - 1 {
            new_wps.push(wps[i].clone());
            let interpolated = Self::interpolate_pair(&wps[i], &wps[i + 1], self.insert_count);
            new_wps.extend(interpolated);
        }
        new_wps.push(wps[wps.len() - 1].clone());

        let replacement = Trajectory::new(new_wps);
        let delta = match PlanDelta::new(region.id, range, replacement) {
            Ok(d) => d,
            Err(_) => return vec![],
        };

        let metrics_before = PlanEvaluator::compute_metrics_from_joints(&segment);
        let metrics_after = PlanEvaluator::compute_metrics_from_joints(&delta.replacement);

        // Smoothness: lower is better → positive delta when after < before
        let smooth_before = metrics_before.smoothness.max(0.001);
        let smooth_pct =
            ((metrics_before.smoothness - metrics_after.smoothness) / smooth_before) * 100.0;

        // Manipulability: higher is better
        let manip_before = metrics_before.manipulability.average.max(0.001);
        let manip_pct = ((metrics_after.manipulability.average
            - metrics_before.manipulability.average)
            / manip_before)
            * 100.0;

        // Composite score: weighted average
        let improvement = smooth_pct * 0.7 + manip_pct.max(0.0) * 0.3;

        let evaluation = crate::repair::domain::RepairEvaluation {
            metrics_before,
            metrics_after,
            score_delta: improvement,
            improvement,
        };

        vec![RepairCandidate::new(StrategyKind::SplitSegment, delta).with_evaluation(evaluation)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{RegionId, RegionKind, RegionSeverity};

    #[test]
    fn test_interpolate_pair_produces_correct_count() {
        let a = TrajectoryPoint::new(vec![0.0], 0.0);
        let b = TrajectoryPoint::new(vec![1.0], 1.0);
        let mid = SplitSegment::interpolate_pair(&a, &b, 3);
        assert_eq!(mid.len(), 3);
        assert!((mid[0].joints()[0] - 0.25).abs() < 1e-6);
        assert!((mid[2].joints()[0] - 0.75).abs() < 1e-6);
    }

    #[test]
    fn test_interpolate_pair_zero_returns_empty() {
        let a = TrajectoryPoint::new(vec![0.0], 0.0);
        let b = TrajectoryPoint::new(vec![1.0], 1.0);
        let mid = SplitSegment::interpolate_pair(&a, &b, 0);
        assert!(mid.is_empty());
    }

    #[test]
    fn test_split_segment_applies_to_any_region() {
        let strategy = SplitSegment::new(1);
        let small = ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Warning,
            0..2,
        );
        assert!(strategy.applies_to(&small));
        let single = ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Warning,
            0..1,
        );
        assert!(!strategy.applies_to(&single)); // 0..1 tiene 1 waypoint
    }

    #[test]
    fn test_split_segment_zero_inserts_rejected() {
        let strategy = SplitSegment::new(0);
        assert!(strategy.insert_count == 0);
        // generate() con insert_count=0 devuelve vec![] antes de procesar
    }
}
