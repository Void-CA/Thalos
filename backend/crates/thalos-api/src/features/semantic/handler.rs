use std::sync::Arc;
use std::time::Instant;

use axum::{Json, extract::State};

use thalos_core::models::RobotModel;
use thalos_core::motion::MotionProfile;
use thalos_planning::motion::{
    planner::{InterpolationConfig, MotionPlanner, PlanningCtx},
    scara::ScaraPlanner,
};
use thalos_semantic::{
    lowering::{context::LoweringContext, SemanticLowering},
    validation::validate,
};

use crate::app::error::ApiError;
use crate::app::state::AppState;
use crate::features::semantic::{
    CompileMetadata, CompileResponse, SemanticCompileRequest, ValidationSummary,
};

/// Compile a semantic task program into an execution plan.
///
/// Accepts a `SemanticCompileRequest` wrapping a `TaskDocument` with
/// a scene (objects, locations, home pose) and a semantic program.
/// The scene's `knowledge()` adapter provides the `KnowledgeProvider`
/// for lowering — no HashMap construction, no DTO conversion.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<CompileResponse>, ApiError> {
    let start = Instant::now();
    let task = payload.task;

    // ── 1. Validate ───────────────────────────────────────────────────
    let validation = validate(&task.program);
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

    // ── 2. Build provider from TaskDocument scene ─────────────────────
    let provider = task.scene.knowledge();

    // ── 3. Lower ──────────────────────────────────────────────────────
    let ctx = LoweringContext {
        provider: &provider,
        default_tool: None,
        default_profile: MotionProfile {
            max_velocity: 1.0,
            max_acceleration: 0.5,
            max_jerk: None,
        },
    };
    let motion_program = SemanticLowering::lower(&task.program, &ctx).map_err(|e| {
        ApiError::Validation {
            message: format!("Semantic lowering failed: {e}"),
            code: "lowering_error".into(),
        }
    })?;
    let instruction_count = motion_program.instructions.len();

    // ── 4. Plan via ScaraPlanner ──────────────────────────────────────
    let planner = ScaraPlanner::new();
    let planning_ctx = PlanningCtx {
        initial_state: vec![0.0, 0.0, 0.0, 0.0],
        robot: RobotModel::Scara,
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
        validation: ValidationSummary {
            errors: vec![],
            warnings,
        },
        metadata: CompileMetadata {
            instruction_count,
            planning_time_ms: elapsed.as_millis() as u64,
        },
        motion_program,
    }))
}
