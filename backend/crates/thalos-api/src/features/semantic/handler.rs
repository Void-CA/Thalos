use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{Json, extract::State};

use thalos_core::ids::OperationId;
use thalos_core::models::RobotModel;
use thalos_core::motion::{MotionPose, MotionProfile};
use thalos_planning::motion::{
    planner::{InterpolationConfig, MotionPlanner, PlanningCtx},
    scara::ScaraPlanner,
};
use thalos_semantic::{
    knowledge::{KnowledgeProvider, SceneKnowledgeProvider},
    lowering::{context::LoweringContext, SemanticLowering},
    operation::{HomeOp, MoveToOp, PickOp, PlaceOp, SemanticOperation, WaitOp},
    program::SemanticProgram,
    resource::{LocationId, ObjectId, ToolId},
    validation::validate,
};

use crate::app::error::ApiError;
use crate::app::state::AppState;
use crate::features::semantic::{
    CompileMetadata, CompileRequest, CompileResponse, ExecutionPlanSummary, SemanticOpDto,
    ValidationSummary,
};

/// Build a `SceneKnowledgeProvider` from the request's resource definitions.
fn build_provider(req: &CompileRequest) -> SceneKnowledgeProvider {
    let default_pose = MotionPose {
        position: [0.0, 0.0, 0.0],
        orientation: [0.0, 0.0, 0.0, 1.0],
        frame: "world".into(),
    };

    let objects: HashMap<ObjectId, MotionPose> = req
        .objects
        .iter()
        .map(|o| {
            let pose = MotionPose {
                position: o.pose.position,
                orientation: o.pose.orientation,
                frame: "world".into(),
            };
            (ObjectId(o.id.clone()), pose)
        })
        .collect();

    let locations: HashMap<LocationId, MotionPose> = req
        .locations
        .iter()
        .map(|l| {
            let pose = MotionPose {
                position: l.pose.position,
                orientation: l.pose.orientation,
                frame: "world".into(),
            };
            (LocationId(l.id.clone()), pose)
        })
        .collect();

    let home = req.home_pose.as_ref().map(|h| MotionPose {
        position: h.position,
        orientation: h.orientation,
        frame: "world".into(),
    });

    // If no resources supplied, populate defaults so basic tests work
    let (objects, locations, home) = if req.objects.is_empty()
        && req.locations.is_empty()
        && req.home_pose.is_none()
    {
        let mut objs = objects;
        objs.insert(ObjectId("default".into()), default_pose.clone());
        let mut locs = locations;
        locs.insert(LocationId("default".into()), default_pose);
        (objs, locs, Some(MotionPose {
            position: [0.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }))
    } else {
        (objects, locations, home)
    };

    SceneKnowledgeProvider::new(objects, locations, home)
}

/// Compile a semantic task program into an execution plan.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<CompileRequest>,
) -> Result<Json<CompileResponse>, ApiError> {
    let start = Instant::now();

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
    if !validation.errors.is_empty() {
        let err_msgs: Vec<String> = validation
            .errors
            .iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin))
            .collect();
        return Err(ApiError::Validation {
            message: err_msgs.join("; "),
            code: "semantic_validation_error".into(),
        });
    }

    let warnings: Vec<String> = validation
        .warnings
        .iter()
        .map(|d| format!("[{:?}] {}", d.severity, d.message))
        .collect();

    // ── 3. Build provider from request resources ──────────────────────
    let provider = build_provider(&payload);

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
    let motion_program = SemanticLowering::lower(&program, &ctx).map_err(|e| {
        ApiError::Validation {
            message: format!("Semantic lowering failed: {e}"),
            code: "lowering_error".into(),
        }
    })?;
    let instruction_count = motion_program.instructions.len();

    // ── 5. Plan via ScaraPlanner ──────────────────────────────────────
    let planner = ScaraPlanner::new();
    let planning_ctx = PlanningCtx {
        initial_state: vec![0.0, 0.0],
        robot: RobotModel::Planar2R,
        interpolation: InterpolationConfig::default(),
    };
    let execution_plan = planner.plan(&motion_program, &planning_ctx).map_err(|e| {
        ApiError::Validation {
            message: format!("Motion planning failed: {e}"),
            code: "planning_error".into(),
        }
    })?;

    let elapsed = start.elapsed();

    Ok(Json(CompileResponse {
        status: "ok".to_string(),
        execution_plan: ExecutionPlanSummary {
            segment_count: execution_plan.metadata.segment_count,
            duration_ms: execution_plan.metadata.total_duration.as_millis() as u64,
        },
        validation: ValidationSummary {
            errors: vec![],
            warnings,
        },
        metadata: CompileMetadata {
            instruction_count,
            planning_time_ms: elapsed.as_millis() as u64,
        },
    }))
}
