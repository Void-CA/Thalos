use serde::{Deserialize, Serialize};

use thalos_core::{
    kinematics::forward::ForwardKinematics,
    prelude::Trajectory,
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};

use crate::scene::precision::VisualPrecision;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum VisualMotionType {
    MoveJ,
    MoveL,
}


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum WaypointType {
    Start,
    Goal,
    Via,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualWaypoint {
    pub position: [f64; 3],
    pub orientation: [f64; 4],
    pub joints: Vec<f64>,
    pub timestamp: f64,
    pub waypoint_type: WaypointType,
}
//
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrajectoryVisualization {
    pub waypoints: Vec<VisualWaypoint>,
    pub motion_type: VisualMotionType,
}

pub struct TrajectoryVisualBuilder;

impl TrajectoryVisualBuilder {
    ///
    pub fn build(
        trajectory: &Trajectory,
        chain: &SerialChain,
        end_effector: FrameId,
        motion_type: VisualMotionType,
    ) -> TrajectoryVisualization {
        let n = trajectory.len();
        let mut waypoints = Vec::with_capacity(n);

        let precision = VisualPrecision::default();

        for (i, point) in trajectory.waypoints().iter().enumerate() {
            let fk = ForwardKinematics::new(chain.clone());
            let fk_result = fk.evaluate(point.joints());

            let (position, orientation) = fk_result
                .pose(&end_effector)
                .map(|pose| {
                    let tx = pose.transform();
                    let mut pos = [tx.translation.x, tx.translation.y, tx.translation.z];
                    let q = tx.rotation.inner();
                    let mut rot = [q.w, q.x, q.y, q.z];
                    precision.normalize_3(&mut pos);
                    normalize_quat(&mut rot);
                    precision.normalize_4(&mut rot);
                    (pos, rot)
                })
                .unwrap_or_default();

            let waypoint_type = if n == 1 {
                // Single waypoint IS the goal (start == goal).
                WaypointType::Goal
            } else if i == 0 {
                WaypointType::Start
            } else if i == n - 1 {
                WaypointType::Goal
            } else {
                WaypointType::Via
            };

            waypoints.push(VisualWaypoint {
                position,
                orientation,
                joints: point.joints().to_vec(),
                timestamp: point.timestamp(),
                waypoint_type,
            });
        }

        TrajectoryVisualization {
            waypoints,
            motion_type,
        }
    }
}
fn normalize_quat(q: &mut [f64; 4]) {
    let norm_sq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if norm_sq > 0.0 {
        let inv = 1.0 / norm_sq.sqrt();
        for v in q.iter_mut() {
            *v *= inv;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        models::{RobotModel, RobotRegistry},
        prelude::TrajectoryPoint,
    };

    #[test]
    fn build_empty_trajectory_returns_empty_waypoints() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let ee = *chain.end_effector();
        let traj = Trajectory::new(vec![]);

        let vis = TrajectoryVisualBuilder::build(&traj, &chain, ee, VisualMotionType::MoveJ);

        assert!(vis.waypoints.is_empty());
        assert_eq!(vis.motion_type, VisualMotionType::MoveJ);
    }

    #[test]
    fn build_single_waypoint_marks_start_and_end() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let ee = *chain.end_effector();
        let traj = Trajectory::new(vec![TrajectoryPoint::new(vec![0.0, 0.0], 0.0)]);

        let vis = TrajectoryVisualBuilder::build(&traj, &chain, ee, VisualMotionType::MoveL);

        assert_eq!(vis.waypoints.len(), 1);
        // Single waypoint is both Start and Goal — marks as Goal.
        assert_eq!(vis.waypoints[0].waypoint_type, WaypointType::Goal);
    }

    #[test]
    fn build_two_waypoints_marks_correctly() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let ee = *chain.end_effector();
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 0.3], 1.0),
        ]);

        let vis = TrajectoryVisualBuilder::build(&traj, &chain, ee, VisualMotionType::MoveJ);

        assert_eq!(vis.waypoints.len(), 2);
        assert_eq!(vis.waypoints[0].waypoint_type, WaypointType::Start);
        assert_eq!(vis.waypoints[1].waypoint_type, WaypointType::Goal);
    }

    #[test]
    fn build_returns_finite_positions() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let ee = *chain.end_effector();
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![1.0, 0.5], 1.0),
        ]);

        let vis = TrajectoryVisualBuilder::build(&traj, &chain, ee, VisualMotionType::MoveJ);

        for (i, wp) in vis.waypoints.iter().enumerate() {
            assert!(
                wp.position.iter().all(|v| v.is_finite()),
                "waypoint {} has non-finite position: {:?}",
                i,
                wp.position,
            );
            assert!(
                wp.orientation.iter().all(|v| v.is_finite()),
                "waypoint {} has non-finite orientation: {:?}",
                i,
                wp.orientation,
            );
        }
    }

    #[test]
    fn build_with_multiple_waypoints_returns_all() {
        let chain = RobotRegistry::create_default(RobotModel::Scara);
        let ee = *chain.end_effector();

        let mut points = Vec::with_capacity(10);
        for i in 0..10 {
            let frac = i as f64 / 9.0;
            points.push(TrajectoryPoint::new(vec![frac, frac, 0.0, 0.0], frac));
        }
        let traj = Trajectory::new(points);

        let vis = TrajectoryVisualBuilder::build(&traj, &chain, ee, VisualMotionType::MoveJ);

        assert_eq!(vis.waypoints.len(), 10);
        assert_eq!(vis.waypoints[0].joints, vec![0.0, 0.0, 0.0, 0.0]);
        assert_eq!(vis.waypoints[9].joints, vec![1.0, 1.0, 0.0, 0.0]);
    }
}
