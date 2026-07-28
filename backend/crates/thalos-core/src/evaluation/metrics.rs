use serde::{Deserialize, Serialize};

/// Quantifiable metrics of a plan — independent of how they were obtained.
///
/// They can come from `WaypointAnalysis` (analyzed plan), a `MotionTrace`
/// (actual execution), or a future physics simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMetrics {
    /// Total path length in joint space (sum of Euclidean distances).
    pub length: f64,
    /// Number of waypoints.
    pub waypoint_count: usize,
    /// Manipulability metrics.
    pub manipulability: ManipulabilityMetrics,
    /// Joint safety metrics.
    pub joint_safety: JointSafetyMetrics,
    /// Collision metrics.
    pub collision: CollisionMetrics,
    /// Trajectory smoothness (average jerk between consecutive waypoints).
    /// Lower = smoother.
    pub smoothness: f64,
    /// Total TCP orientation change (radians).
    pub orientation_change: f64,
}

impl PlanMetrics {
    /// Create metrics from pre-computed values.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        length: f64,
        waypoint_count: usize,
        manipulability: ManipulabilityMetrics,
        joint_safety: JointSafetyMetrics,
        collision: CollisionMetrics,
        smoothness: f64,
        orientation_change: f64,
    ) -> Self {
        Self {
            length,
            waypoint_count,
            manipulability,
            joint_safety,
            collision,
            smoothness,
            orientation_change,
        }
    }
}

/// Manipulability metrics along the trajectory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManipulabilityMetrics {
    /// Minimum Yoshikawa value across any waypoint.
    pub min: f64,
    /// Average Yoshikawa value.
    pub average: f64,
    /// Number of waypoints at or near singularity.
    pub near_singular_count: usize,
    /// Number of waypoints in singularity.
    pub singular_count: usize,
}

impl ManipulabilityMetrics {
    pub fn new(min: f64, average: f64, near_singular_count: usize, singular_count: usize) -> Self {
        Self {
            min,
            average,
            near_singular_count,
            singular_count,
        }
    }
}

/// Safety metrics regarding joint limits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JointSafetyMetrics {
    /// Minimum margin to any joint limit (fraction 0.0–1.0).
    /// 1.0 = centered in range, 0.0 = at limit.
    pub min_margin: f64,
    /// Average of the worst utilization per waypoint.
    pub avg_max_utilization: f64,
    /// Number of limit violations.
    pub violation_count: usize,
}

impl JointSafetyMetrics {
    pub fn new(min_margin: f64, avg_max_utilization: f64, violation_count: usize) -> Self {
        Self {
            min_margin,
            avg_max_utilization,
            violation_count,
        }
    }
}

/// Collision metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollisionMetrics {
    /// Minimum distance to obstacles (negative = collision).
    pub min_distance: f64,
    /// Number of waypoints in collision.
    pub collision_count: usize,
    /// Number of waypoints near collision.
    pub near_miss_count: usize,
}

impl CollisionMetrics {
    pub fn new(min_distance: f64, collision_count: usize, near_miss_count: usize) -> Self {
        Self {
            min_distance,
            collision_count,
            near_miss_count,
        }
    }
}

/// Identifier for a metric — used as key in `CostFunction.weights`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MetricKind {
    PathLength,
    Manipulability,
    JointMargin,
    CollisionRisk,
    Smoothness,
    OrientationChange,
}

impl MetricKind {
    /// Default weight for each metric.
    pub fn default_weight(&self) -> f64 {
        match self {
            MetricKind::PathLength => 0.3,
            MetricKind::Manipulability => 1.0,
            MetricKind::JointMargin => 0.5,
            MetricKind::CollisionRisk => 2.0,
            MetricKind::Smoothness => 0.4,
            MetricKind::OrientationChange => 0.2,
        }
    }

    /// Return all kinds with their default weights.
    pub fn all_with_defaults() -> Vec<(Self, f64)> {
        vec![
            (Self::PathLength, 0.3),
            (Self::Manipulability, 1.0),
            (Self::JointMargin, 0.5),
            (Self::CollisionRisk, 2.0),
            (Self::Smoothness, 0.4),
            (Self::OrientationChange, 0.2),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_metrics_new() {
        let m = PlanMetrics::new(
            1.5,
            100,
            ManipulabilityMetrics::new(0.1, 0.5, 2, 0),
            JointSafetyMetrics::new(0.3, 0.7, 0),
            CollisionMetrics::new(0.05, 0, 1),
            0.8,
            1.2,
        );
        assert!((m.length - 1.5).abs() < 1e-10);
        assert_eq!(m.waypoint_count, 100);
    }

    #[test]
    fn metric_kind_default_weights() {
        let all = MetricKind::all_with_defaults();
        assert_eq!(all.len(), 6);
        let map: std::collections::HashMap<_, _> = all.into_iter().collect();
        assert!((map[&MetricKind::CollisionRisk] - 2.0).abs() < 1e-10);
    }

    #[test]
    fn metric_kind_equality() {
        assert_eq!(MetricKind::PathLength, MetricKind::PathLength);
        assert_ne!(MetricKind::PathLength, MetricKind::Manipulability);
    }
}
