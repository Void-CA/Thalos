use std::sync::Arc;
use std::time::Duration;

use axum::{Json, extract::State};

use thalos_core::models::RobotModel;
use thalos_core::motion::MotionProgram;
use thalos_planning::motion::{
    execution::{ExecutionPlan, ExecutionSegment},
    planner::{InterpolationConfig, MotionPlanner, PlanningCtx},
    scara::ScaraPlanner,
};

use crate::app::error::ApiError;
use crate::app::state::AppState;
use crate::features::planning::{PlanResponse, WaypointDto};

/// Extract all waypoints from an ExecutionPlan as a flat time-ordered list.
fn extract_waypoints(plan: &ExecutionPlan) -> Vec<WaypointDto> {
    let mut waypoints = Vec::new();
    let mut time_offset = Duration::ZERO;

    for segment in &plan.segments {
        match segment {
            ExecutionSegment::JointTrajectory { samples } => {
                for sample in samples {
                    waypoints.push(WaypointDto {
                        time_secs: (time_offset + sample.time).as_secs_f64(),
                        joints: sample.joints.clone(),
                    });
                }
                if let Some(last) = samples.last() {
                    time_offset += last.time;
                }
            }
            ExecutionSegment::CartesianTrajectory { resolved, .. } => {
                // Use the resolved IK solutions (joint states for each Cartesian sample)
                for (i, joints) in resolved.iter().enumerate() {
                    let t = time_offset
                        + Duration::from_secs_f64(
                            i as f64 / resolved.len().max(1) as f64 * 0.1,
                        );
                    waypoints.push(WaypointDto {
                        time_secs: t.as_secs_f64(),
                        joints: joints.clone(),
                    });
                }
                // Approximate duration — in a real scenario this comes from the trajectory
                time_offset += Duration::from_secs_f64(resolved.len() as f64 * 0.01);
            }
            ExecutionSegment::Pause { duration } => {
                time_offset += *duration;
            }
            ExecutionSegment::Output { .. } => {
                // Output events don't produce waypoints
            }
        }
    }

    waypoints
}

/// Plan a MotionProgram into an ExecutionPlan and return waypoints.
pub async fn plan_motion(
    State(_state): State<Arc<AppState>>,
    Json(program): Json<MotionProgram>,
) -> Result<Json<PlanResponse>, ApiError> {
    let planner = ScaraPlanner::new();
    let planning_ctx = PlanningCtx {
        initial_state: vec![0.0, 0.0, 0.0, 0.0],
        robot: RobotModel::Scara,
        interpolation: InterpolationConfig::default(),
    };

    let execution_plan = planner.plan(&program, &planning_ctx).map_err(|e| {
        ApiError::Validation {
            message: format!("Planning failed: {e}"),
            code: "planning_error".into(),
        }
    })?;

    let waypoints = extract_waypoints(&execution_plan);
    let total_duration = execution_plan.metadata.total_duration;

    Ok(Json(PlanResponse {
        status: "ok".to_string(),
        segment_count: execution_plan.metadata.segment_count,
        total_duration_secs: total_duration.as_secs_f64(),
        robot_model: execution_plan.metadata.robot_model,
        waypoints,
    }))
}
