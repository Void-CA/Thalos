use std::sync::Arc;
use std::time::Duration;

use axum::{Json, extract::State};

use thalos_core::ids::OperationId;
use thalos_core::models::RobotModel;
use thalos_core::motion::{MotionPose, MotionProfile};
use thalos_planning::motion::{
    planner::{InterpolationConfig, MotionPlanner, PlanningCtx},
    scara::ScaraPlanner,
};
use thalos_semantic::{
    knowledge::{GraspPlan, MockKnowledgeProvider, PlacementPlan},
    lowering::{context::LoweringContext, SemanticLowering},
    operation::{HomeOp, MoveToOp, PickOp, PlaceOp, SemanticOperation, WaitOp},
    program::SemanticProgram,
    resource::{LocationId, ObjectId, ToolId},
    validation::validate,
};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::semantic::{CompileRequest, CompileResponse, SemanticOpDto};

/// Compile a semantic task program into an execution plan.
///
/// Accepts a sequence of semantic operations (Pick, Place, MoveTo, Wait, Home),
/// validates them, lowers to a MotionProgram, and plans through ScaraPlanner.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<CompileRequest>,
) -> ApiResult<CompileResponse> {
    // ── 1. Convert DTOs to SemanticOperations ─────────────────────────
    let mut operations = Vec::new();
    for (i, op_dto) in payload.operations.iter().enumerate() {
        let origin = OperationId(format!("op_{}", i));
        let sem_op = match op_dto {
            SemanticOpDto::Pick { object, tool } => SemanticOperation::Pick(PickOp {
                origin,
                object: ObjectId(object.clone()),
                tool: tool.clone().map(ToolId),
            }),
            SemanticOpDto::Place {
                object,
                destination,
                tool,
            } => SemanticOperation::Place(PlaceOp {
                origin,
                object: ObjectId(object.clone()),
                destination: LocationId(destination.clone()),
                tool: tool.clone().map(ToolId),
            }),
            SemanticOpDto::MoveTo { destination, tool } => SemanticOperation::MoveTo(MoveToOp {
                origin,
                destination: LocationId(destination.clone()),
                tool: tool.clone().map(ToolId),
            }),
            SemanticOpDto::Wait { duration_secs } => SemanticOperation::Wait(WaitOp {
                origin,
                duration: Duration::from_secs_f64(*duration_secs),
            }),
            SemanticOpDto::Home => SemanticOperation::Home(HomeOp { origin }),
        };
        operations.push(sem_op);
    }

    let program = SemanticProgram::new(operations);

    // ── 2. Validate ───────────────────────────────────────────────────
    let validation = validate(&program);
    let warnings: Vec<String> = validation
        .warnings
        .iter()
        .map(|d| format!("[{:?}] {}", d.severity, d.message))
        .collect();
    if !validation.errors.is_empty() {
        let msgs: Vec<String> = validation
            .errors
            .iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin))
            .collect();
        return Ok(Json(CompileResponse {
            status: "error".to_string(),
            segment_count: 0,
            duration_ms: 0,
            warnings: msgs,
        }));
    }

    // ── 3. Build a default provider ───────────────────────────────────
    // In v1, all resources resolve to the origin. A real provider would
    // consult the project's scene/knowledge base.
    let default_pose = MotionPose {
        position: [0.0, 0.0, 0.0],
        orientation: [0.0, 0.0, 0.0, 1.0],
        frame: "world".into(),
    };
    let provider = MockKnowledgeProvider::new()
        .with_grasp_ok(
            ObjectId("default".into()),
            GraspPlan {
                grasp_frame: default_pose.clone(),
                approach_frame: default_pose.clone(),
                retreat_frame: default_pose.clone(),
                preferred_tool: None,
            },
        )
        .with_place_ok(
            ObjectId("default".into()),
            LocationId("default".into()),
            PlacementPlan {
                drop_frame: default_pose.clone(),
                approach_frame: default_pose.clone(),
                retreat_frame: default_pose.clone(),
            },
        )
        .with_location_ok(LocationId("default".into()), default_pose.clone())
        .with_home_pose(Ok(default_pose));

    // ── 4. Lower ──────────────────────────────────────────────────────
    let ctx = LoweringContext {
        provider: &provider,
        default_tool: None,
        default_profile: MotionProfile {
            max_velocity: 1.0,
            max_acceleration: 0.5,
            max_jerk: None,
        },
    };
    let motion_program = match SemanticLowering::lower(&program, &ctx) {
        Ok(mp) => mp,
        Err(e) => {
            return Ok(Json(CompileResponse {
                status: "error".to_string(),
                segment_count: 0,
                duration_ms: 0,
                warnings: vec![format!("Lowering failed: {e}")],
            }));
        }
    };

    // ── 5. Plan via ScaraPlanner ──────────────────────────────────────
    let planner = ScaraPlanner::new();
    let planning_ctx = PlanningCtx {
        initial_state: vec![0.0, 0.0],
        robot: RobotModel::Planar2R,
        interpolation: InterpolationConfig::default(),
    };
    let execution_plan = match planner.plan(&motion_program, &planning_ctx) {
        Ok(ep) => ep,
        Err(e) => {
            return Ok(Json(CompileResponse {
                status: "error".to_string(),
                segment_count: 0,
                duration_ms: 0,
                warnings: vec![format!("Planning failed: {e}")],
            }));
        }
    };

    let duration_ms = execution_plan.metadata.total_duration.as_millis();

    Ok(Json(CompileResponse {
        status: "ok".to_string(),
        segment_count: execution_plan.metadata.segment_count,
        duration_ms: duration_ms as u64,
        warnings,
    }))
}
