//! JointCenteringOperator — desplaza las articulaciones hacia el centro
//! de su rango de movimiento para mejorar margen articular.
//!
//! Este operador es puramente geométrico: no requiere cinemática inversa.
//! Calcula `q_center = (q_min + q_max) / 2` para cada articulación y
//! desplaza cada waypoint hacia el centro según un factor configurable.

use thalos_core::{
    analysis::region::{ProblemRegion, RegionKind},
    evaluation::PlanMetrics,
    robot::serial_chain::SerialChain,
    trajectory::{Trajectory, TrajectoryPoint},
};

use crate::{
    domain::{context::OptimizationContext, operator::OperatorFamily, TrajectoryOperator},
    error::OptimizationError,
};

/// Operator that moves joint positions toward the center of their
/// mechanical range, increasing joint safety margins.
///
/// # How it works
///
/// For each waypoint in the problem region:
///   1. Compute `q_center = (q_min + q_max) / 2` for each joint
///   2. Compute `q_new = q + (q_center - q) * factor`
///
/// The `factor` controls how aggressively joints are centered:
/// - `0.0` → no change
/// - `0.3` → move 30 % toward center
/// - `1.0` → snap to center
///
/// Timestamps and waypoints outside the region are preserved unchanged.
pub struct JointCenteringOperator {
    /// How much to move each joint toward its center per application
    /// (0.0–1.0). 0.3 means "move 30 % of the distance to center".
    factor: f32,
}

impl JointCenteringOperator {
    /// Create a new operator with the given centering factor.
    ///
    /// The factor is clamped to `[0.0, 1.0]`.
    pub fn new(factor: f32) -> Self {
        Self {
            factor: factor.clamp(0.0, 1.0),
        }
    }

    /// Default centering factor (0.3).
    pub const DEFAULT_FACTOR: f32 = 0.3;
}

impl TrajectoryOperator for JointCenteringOperator {
    fn id(&self) -> &'static str {
        "joint_centering"
    }

    fn family(&self) -> OperatorFamily {
        OperatorFamily::JointSpace
    }

    fn applicability(&self, region: &ProblemRegion) -> f32 {
        match region.kind {
            // Constraint and Singularity regions benefit most from
            // centering — joints are near their limits.
            RegionKind::Constraint | RegionKind::Singularity => 0.85,
            // Other regions may still benefit, but less directly.
            _ => 0.5,
        }
    }

    fn estimate_improvement(&self, region: &ProblemRegion, _metrics: &PlanMetrics) -> f32 {
        // Estimate based on how much region type benefits from centering.
        match region.kind {
            RegionKind::Constraint => 0.4,
            RegionKind::Singularity => 0.3,
            RegionKind::Collision => 0.15,
            _ => 0.1,
        }
    }

    fn estimate_cost(&self) -> f32 {
        // Very cheap — no IK, no complex computation.
        0.2
    }

    fn apply(
        &self,
        _robot: &SerialChain,
        trajectory: &Trajectory,
        region: &ProblemRegion,
        ctx: &OptimizationContext,
    ) -> Result<Trajectory, OptimizationError> {
        let range = region.waypoint_range.clone();
        let waypoints = trajectory.waypoints();

        // Validate range bounds
        if range.start >= waypoints.len() || range.end > waypoints.len() {
            return Err(OptimizationError::InvalidRegion(format!(
                "waypoint range {:?} is out of bounds for trajectory length {}",
                range,
                waypoints.len()
            )));
        }

        if range.is_empty() {
            return Ok(trajectory.clone());
        }

        let joint_limits = &ctx.joint_limits;
        let num_joints = joint_limits.lower.len();

        if num_joints == 0 {
            return Err(OptimizationError::InvalidRegion(
                "joint limits are empty — cannot center joints".into(),
            ));
        }

        // Compute q_center = (lower + upper) / 2 for each joint
        let centers: Vec<f64> = joint_limits
            .lower
            .iter()
            .zip(joint_limits.upper.iter())
            .map(|(l, u)| (l + u) / 2.0)
            .collect();

        let factor = self.factor as f64;

        // Build the modified waypoint list
        let mut new_waypoints: Vec<TrajectoryPoint> = waypoints.to_vec();

        for i in range {
            let wp = &new_waypoints[i];
            let q = wp.joints();

            if q.len() != num_joints {
                return Err(OptimizationError::InvalidRegion(format!(
                    "waypoint {} has {} joints, expected {}",
                    i,
                    q.len(),
                    num_joints
                )));
            }

            // q_new = q + (q_center - q) * factor
            let new_joints: Vec<f64> = q
                .iter()
                .zip(centers.iter())
                .map(|(q_i, center)| q_i + (center - q_i) * factor)
                .collect();

            new_waypoints[i] = TrajectoryPoint::new(new_joints, wp.timestamp());
        }

        Ok(Trajectory::new(new_waypoints))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        analysis::region::{RegionId, RegionSeverity},
        evaluation::JointSafetyMetrics,
        models::{RobotModel, RobotRegistry},
    };

    use crate::{
        domain::context::{JointLimits, PipelineConfig},
        PlanMetrics,
    };

    // ── Test helpers ──────────────────────────────────────

    fn test_region(kind: RegionKind) -> ProblemRegion {
        ProblemRegion::new(RegionId(0), kind, RegionSeverity::Warning, 0..3)
    }

    fn test_trajectory() -> Trajectory {
        Trajectory::new(vec![
            TrajectoryPoint::new(vec![-1.0, -1.0], 0.0),
            TrajectoryPoint::new(vec![0.0, 0.0], 1.0),
            TrajectoryPoint::new(vec![1.0, 1.0], 2.0),
            TrajectoryPoint::new(vec![2.0, 2.0], 3.0),
        ])
    }

    fn test_ctx() -> OptimizationContext {
        OptimizationContext {
            joint_limits: JointLimits {
                lower: vec![-2.0, -2.0],
                upper: vec![2.0, 2.0],
            },
            config: PipelineConfig::default(),
        }
    }

    #[allow(dead_code)]
    fn test_metrics() -> PlanMetrics {
        PlanMetrics::new(
            0.0,
            0,
            thalos_core::evaluation::ManipulabilityMetrics::new(0.0, 0.0, 0, 0),
            JointSafetyMetrics::new(1.0, 0.0, 0),
            thalos_core::evaluation::CollisionMetrics::new(1.0, 0, 0),
            0.0,
            0.0,
        )
    }

    // ── applicability tests ──────────────────────────────

    #[test]
    fn applicability_for_constraint_is_high() {
        let op = JointCenteringOperator::new(0.3);
        let region = test_region(RegionKind::Constraint);
        assert!(
            op.applicability(&region) >= 0.8,
            "expected >= 0.8 for Constraint, got {}",
            op.applicability(&region)
        );
    }

    #[test]
    fn applicability_for_singularity_is_high() {
        let op = JointCenteringOperator::new(0.3);
        let region = test_region(RegionKind::Singularity);
        assert!(
            op.applicability(&region) >= 0.8,
            "expected >= 0.8 for Singularity, got {}",
            op.applicability(&region)
        );
    }

    #[test]
    fn applicability_for_other_regions_is_medium() {
        let op = JointCenteringOperator::new(0.3);
        let region = test_region(RegionKind::Collision);
        let app = op.applicability(&region);
        assert!(
            (0.4..=0.6).contains(&app),
            "expected ~0.5 for Collision, got {}",
            app
        );
    }

    // ── estimate_cost test ───────────────────────────────

    #[test]
    fn estimate_cost_is_low() {
        let op = JointCenteringOperator::new(0.3);
        assert!(
            op.estimate_cost() <= 0.25,
            "expected cost <= 0.25, got {}",
            op.estimate_cost()
        );
    }

    // ── apply tests ───────────────────────────────────────

    #[test]
    fn apply_returns_trajectory_with_same_length() {
        let op = JointCenteringOperator::new(0.5);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = test_region(RegionKind::Constraint);
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), traj.len());
    }

    #[test]
    fn apply_centers_joints_toward_midpoint() {
        let op = JointCenteringOperator::new(1.0); // snap to center
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = test_region(RegionKind::Constraint);
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());

        let optimized = result.unwrap();
        let waypoints = optimized.waypoints();

        // For factor=1.0, joints should be exactly at center (0.0)
        // Region covers waypoints 0..3 (first 3 waypoints)
        for wp in waypoints.iter().take(3) {
            for q in wp.joints() {
                assert!(
                    (q - 0.0).abs() < 1e-10,
                    "expected joint at center (0.0), got {}",
                    q
                );
            }
        }
    }

    #[test]
    fn apply_preserves_waypoints_outside_region() {
        let op = JointCenteringOperator::new(1.0);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = test_region(RegionKind::Constraint);
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());

        let optimized = result.unwrap();
        let waypoints = optimized.waypoints();

        // Last waypoint (index 3) is outside region 0..3 — should be unchanged
        let original_last = traj.waypoints().last().unwrap();
        let optimized_last = waypoints.last().unwrap();
        assert_eq!(original_last.joints(), optimized_last.joints());
    }

    #[test]
    fn apply_partial_factor_works_correctly() {
        let op = JointCenteringOperator::new(0.5); // 50 % toward center
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Constraint,
            RegionSeverity::Warning,
            0..1, // only first waypoint
        );
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());

        let optimized = result.unwrap();
        let wp = &optimized.waypoints()[0];

        // Joints start at [-1.0, -1.0], center = [0.0, 0.0], factor=0.5
        // q_new = [-1.0 + (0.0 - (-1.0)) * 0.5] = -0.5
        assert!(
            (wp.joints()[0] - (-0.5)).abs() < 1e-10,
            "expected -0.5, got {}",
            wp.joints()[0]
        );
        assert!(
            (wp.joints()[1] - (-0.5)).abs() < 1e-10,
            "expected -0.5, got {}",
            wp.joints()[1]
        );
    }

    #[test]
    fn apply_on_single_waypoint_region_modifies_only_that_point() {
        let op = JointCenteringOperator::new(1.0);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Constraint,
            RegionSeverity::Warning,
            1..2, // only the second waypoint (index 1)
        );
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());

        let optimized = result.unwrap();
        let waypoints = optimized.waypoints();

        // Index 0 (outside region) → unchanged
        assert_eq!(waypoints[0].joints(), &[-1.0, -1.0]);
        // Index 1 (inside region) → centered to [0.0, 0.0]
        assert!((waypoints[1].joints()[0] - 0.0).abs() < 1e-10);
        assert!((waypoints[1].joints()[1] - 0.0).abs() < 1e-10);
        // Index 2, 3 (outside region) → unchanged
        assert_eq!(waypoints[2].joints(), &[1.0, 1.0]);
        assert_eq!(waypoints[3].joints(), &[2.0, 2.0]);
    }

    #[test]
    fn apply_out_of_bounds_region_returns_error() {
        let op = JointCenteringOperator::new(0.5);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Constraint,
            RegionSeverity::Warning,
            0..100, // way beyond trajectory length
        );
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_err());
    }

    #[test]
    fn factor_is_clamped() {
        let op = JointCenteringOperator::new(1.5);
        assert!((op.factor - 1.0).abs() < f32::EPSILON);

        let op = JointCenteringOperator::new(-0.5);
        assert!((op.factor - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn preserves_timestamps() {
        let op = JointCenteringOperator::new(0.5);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = test_region(RegionKind::Constraint);
        let ctx = test_ctx();

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());

        let optimized = result.unwrap();
        for (orig, opt) in traj.waypoints().iter().zip(optimized.waypoints().iter()) {
            assert!(
                (orig.timestamp() - opt.timestamp()).abs() < 1e-10,
                "timestamp changed from {} to {}",
                orig.timestamp(),
                opt.timestamp()
            );
        }
    }
}
