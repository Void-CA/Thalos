//! Handler para el endpoint de análisis de planes.
//!
//! POST /api/v1/plan/analyze
//!
//! Analiza el plan activo del runtime y retorna la PROYECCIÓN del
//! [`AnalysisReport`](thalos_core::analysis::report::AnalysisReport) del
//! dominio: artifact + observations + actions + metrics + summary (+
//! `problem_regions` legacy vía adapter de DTO).

use std::sync::Arc;

use axum::{Json, extract::State};

use thalos_core::{
    analysis::RegionGrouper, analysis::observation::ArtifactRef, ids::MotionPlanId,
    kinematics::forward::ForwardKinematics,
    kinematics::inverse::DampedLeastSquaresSolver,
    robot::state::RobotState,
};
use thalos_optimization::{
    PlanMetrics,
    domain::{JointLimits, OptimizationContext, PipelineConfig, TrajectoryOperator},
    operators::{
        AdaptiveSampling, JointCenteringOperator, NullSpaceOptimization, OrientationRelaxation,
        Retime,
    },
    pipeline::OptimizationPipeline,
};
use thalos_planning::{
    advisor::PlanAdvisor,
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
        program::{PlannedSegment, PlanningProgram},
    },
    recommendation::{RecommendationId, RecommendationStatus},
};
use thalos_runtime::{CommandMetrics, PlanAnalysisService};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::plan_analysis::dto::{
    ApplyRequest, ApplyResponse, MetricsComparisonDto, OperatorAppliedDto, OptimizeResponse,
    PlanAnalysisRequest, PlanAnalysisResponse, PreviewRequest, PreviewResponse, UndoResponse,
};

/// POST /api/v1/plan/analyze
pub async fn analyze_plan(
    State(state): State<Arc<AppState>>,
    Json(_req): Json<PlanAnalysisRequest>,
) -> ApiResult<PlanAnalysisResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // Obtener la trayectoria del plan activo
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to analyze".to_string(),
            code: "no_active_plan".to_string(),
        })?;
    let trajectory = &active_plan.trajectory;
    // I3: cada observación del reporte queda anclada a este MotionPlan. O3: el
    // identificador REAL disponible (plan_id) es el que expone el wire.
    let artifact = ArtifactRef::MotionPlan(MotionPlanId(active_plan.plan_id.clone()));

    // PR 3: segments carry operation provenance (operation_id + role) when the
    // plan was compiled through compile_with_operations(). The DTO adapter
    // projects each problem region back to its originating operation.
    let segments: &[PlannedSegment] = snapshot
        .active_plan
        .as_ref()
        .and_then(|p| p.segments.as_deref())
        .unwrap_or(&[]);

    let result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None, // constraints opcionales
        artifact,
    )?;

    // El wire es una proyección del reporte canónico (I6): el handler no
    // construye modelos intermedios entre dominio y contrato.
    Ok(Json(PlanAnalysisResponse::from_report(
        &result.report,
        &result.analysis,
        segments,
        &result.recommendations,
    )))
}

/// POST /api/v1/plan/commands/preview
///
/// Simulación READ-ONLY de una recomendación (PR3, spec command-endpoints
/// "Preview Endpoint"): la edición se aplica sobre un CLON del programa
/// semántico, se recompila y se re-analiza, y se devuelven los waypoints de la
/// trayectoria resultante + métricas antes/después. El `SceneRuntime` NUNCA se
/// muta — no hay `replace_active_plan`, no hay snapshot de escena.
///
/// Data flow (design PR3): `clone program → edit.apply(clone) → recompile →
/// re-analyze → return waypoints; NO state mutation`.
pub async fn preview_command(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewRequest>,
) -> ApiResult<PreviewResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // 1. Plan activo — la fuente del programa semántico (I1) y la trayectoria
    //    "before" para las métricas.
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to preview".to_string(),
            code: "no_active_plan".to_string(),
        })?;
    let artifact = ArtifactRef::MotionPlan(MotionPlanId(active_plan.plan_id.clone()));

    // 2. Reconstruir el `PlanningProgram` desde los segmentos compilados
    //    (`PlannedSegment.source` preserva el comando semántico, invariante
    //    I2). Es un CLON — la edición nunca toca el plan del runtime.
    let program = {
        let segments = active_plan.segments.as_deref().ok_or_else(|| {
            ApiError::InvalidState {
                message: "Active plan carries no program segments".to_string(),
                code: "no_program_segments".to_string(),
            }
        })?;
        if segments.is_empty() {
            return Err(ApiError::InvalidState {
                message: "Active plan has no program segments".to_string(),
                code: "no_program_segments".to_string(),
            });
        }
        PlanningProgram::new(segments.iter().map(|s| s.source.clone()).collect())
    };

    // 3. Análisis "before" + materialización de recomendaciones (el mismo
    //    determinismo del advisor: mismas observaciones + mismo programa →
    //    mismas recomendaciones). El id del wire resuelve contra esta lista.
    let before = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        &active_plan.trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact.clone(),
    )?;

    let fk = ForwardKinematics::new(snapshot.chain.clone());
    let solver = DampedLeastSquaresSolver::new(fk, snapshot.resolve_default_frame(), 500, 1e-6, 0.1);
    let recommendations = PlanAdvisor.recommend(
        &before.report.observations,
        &program,
        &solver,
        &snapshot.joints,
    );

    let recommendation = recommendations
        .iter()
        .find(|r| r.id == RecommendationId(req.recommendation_id))
        .ok_or_else(|| ApiError::NotFound {
            message: format!(
                "Recommendation {} not found in the active plan",
                req.recommendation_id
            ),
        })?;

    // 4. SIMULATE — aplicar la edición sobre el CLON y recompilar desde el
    //    mismo estado inicial que el plan activo (el primer waypoint de su
    //    trayectoria). `apply` es no-mutante por contrato (PR1).
    let edited_program = recommendation
        .edit
        .apply(&program)
        .map_err(|e| ApiError::Validation {
            message: e.to_string(),
            code: "edit_apply_failed".to_string(),
        })?;

    let start_joints = active_plan
        .trajectory
        .waypoints()
        .first()
        .map(|w| w.joints().to_vec())
        .unwrap_or_else(|| snapshot.joints.clone());
    let current_state = RobotState::new(start_joints);
    let ctx = SegmentPlanningContext {
        robot: &snapshot.chain,
        current_state: &current_state,
        ik_solver: &solver,
        tcp: snapshot.active_tcp.as_ref(),
    };
    let compiled = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()))
        .compile(&edited_program, &ctx)
        .map_err(|e| ApiError::Validation {
            message: e.to_string(),
            code: "recompile_failed".to_string(),
        })?;

    // 5. Análisis "after" sobre la trayectoria editada.
    let after = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        &compiled.merged_trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact,
    )?;

    // 6. Waypoints del efector final para el overlay 3D (mismo patrón que
    //    `OptimizeResponse.optimized_positions`).
    let fk_out = ForwardKinematics::new(snapshot.chain.clone());
    let waypoints: Vec<[f64; 3]> = compiled
        .merged_trajectory
        .waypoints()
        .iter()
        .filter_map(|wp| {
            fk_out
                .evaluate(wp.joints())
                .ee_position()
                .map(|p| [p.x, p.y, p.z])
        })
        .collect();

    // 7. Continuidad: la trayectoria recompilada es un continuo sin huecos
    //    (timestamps estrictamente crecientes — la compilación es atómica).
    let continuity = {
        let wps = compiled.merged_trajectory.waypoints();
        !wps.is_empty() && wps.windows(2).all(|w| w[1].timestamp() > w[0].timestamp())
    };

    let health_before = before.report.summary.quality_index;
    let health_after = after.report.summary.quality_index;

    Ok(Json(PreviewResponse {
        recommendation_id: recommendation.id.0,
        status: recommendation.status,
        waypoints,
        metrics_before: before.report.metrics.clone(),
        metrics_after: after.report.metrics.clone(),
        health_before,
        health_after,
        improvement: health_after - health_before,
        continuity,
    }))
}

/// POST /api/v1/plan/commands/apply
///
/// WRITE-BACK de una recomendación (PR4, spec command-endpoints "Apply
/// Endpoint"). Flujo (design D4/D5 — milestone de mayor riesgo, diseñado
/// primero):
///
/// 1. Resolver la recomendación (mismo determinismo que preview — el preview
///    NO es prerequisito, spec "Apply without prior preview").
/// 2. Gate D8: un edit `unavailable` jamás se aplica — error explícito.
/// 3. `edit.apply(&program)` → recompilar → `replace_active_plan` (snapshot +
///    restore atómico + feature flag `scene-writeback`, OFF por defecto).
/// 4. El inverse se almacena en memoria (D6) para el undo O(1) de PR5 — el
///    endpoint undo llega en PR5.
pub async fn apply_command(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ApplyRequest>,
) -> ApiResult<ApplyResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // 1. Plan activo — fuente del programa semántico (I1/I2).
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to apply".to_string(),
            code: "no_active_plan".to_string(),
        })?;
    let artifact = ArtifactRef::MotionPlan(MotionPlanId(active_plan.plan_id.clone()));

    let program = {
        let segments = active_plan.segments.as_deref().ok_or_else(|| {
            ApiError::InvalidState {
                message: "Active plan carries no program segments".to_string(),
                code: "no_program_segments".to_string(),
            }
        })?;
        if segments.is_empty() {
            return Err(ApiError::InvalidState {
                message: "Active plan has no program segments".to_string(),
                code: "no_program_segments".to_string(),
            });
        }
        PlanningProgram::new(segments.iter().map(|s| s.source.clone()).collect())
    };

    // 2. Análisis "before" + resolución de la recomendación.
    let before = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        &active_plan.trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact.clone(),
    )?;

    let fk = ForwardKinematics::new(snapshot.chain.clone());
    let solver =
        DampedLeastSquaresSolver::new(fk, snapshot.resolve_default_frame(), 500, 1e-6, 0.1);
    let recommendations = PlanAdvisor.recommend(
        &before.report.observations,
        &program,
        &solver,
        &snapshot.joints,
    );

    let recommendation = recommendations
        .iter()
        .find(|r| r.id == RecommendationId(req.recommendation_id))
        .ok_or_else(|| ApiError::NotFound {
            message: format!(
                "Recommendation {} not found in the active plan",
                req.recommendation_id
            ),
        })?;

    // 3. Gate D8: unavailable → error explícito, nunca se aplica.
    if recommendation.status == Some(RecommendationStatus::Unavailable) {
        return Err(ApiError::Conflict {
            message: format!(
                "Recommendation {} is unavailable and cannot be applied",
                req.recommendation_id
            ),
            code: "recommendation_unavailable".to_string(),
        });
    }

    // 4. Aplicar la edición sobre el programa y recompilar desde el mismo
    //    estado inicial que el plan activo (mismo start que preview).
    let edited_program = recommendation
        .edit
        .apply(&program)
        .map_err(|e| ApiError::Validation {
            message: e.to_string(),
            code: "edit_apply_failed".to_string(),
        })?;

    let start_joints = active_plan
        .trajectory
        .waypoints()
        .first()
        .map(|w| w.joints().to_vec())
        .unwrap_or_else(|| snapshot.joints.clone());
    let current_state = RobotState::new(start_joints);
    let ctx = SegmentPlanningContext {
        robot: &snapshot.chain,
        current_state: &current_state,
        ik_solver: &solver,
        tcp: snapshot.active_tcp.as_ref(),
    };
    let compiled = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()))
        .compile(&edited_program, &ctx)
        .map_err(|e| ApiError::Validation {
            message: e.to_string(),
            code: "recompile_failed".to_string(),
        })?;

    // 5. Análisis "after" sobre la trayectoria recompilada (la misma que el
    //    write-back va a activar — no depende del snapshot del runtime).
    let after = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        &compiled.merged_trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact,
    )?;

    // 6. WRITE-BACK (D4/D5): replace_active_plan con snapshot+restore y flag
    //    `scene-writeback`; el inverse y las métricas se almacenan en memoria
    //    (D6) para el undo O(1) de PR5.
    let health_before = before.report.summary.quality_index;
    let health_after = after.report.summary.quality_index;
    let applied_snapshot = state
        .services
        .scene
        .apply_compiled_plan(
            compiled.clone(),
            recommendation.edit.clone(),
            recommendation.edit.inverse(),
            CommandMetrics::new(health_before, health_after),
        )
        .await?;

    Ok(Json(ApplyResponse {
        recommendation_id: recommendation.id.0,
        status: recommendation.status,
        plan_id: applied_snapshot
            .active_plan
            .as_ref()
            .map(|p| p.plan_id.clone())
            .unwrap_or_default(),
        health_before,
        health_after,
        improvement: health_after - health_before,
        history_length: state.services.scene.history_len().await,
    }))
}

/// POST /api/v1/plan/commands/undo
///
/// Undo O(1) (design D6, spec command-endpoints "Undo Endpoint"): pop del
/// último comando aplicado, `apply(inverse)` UNA sola vez (nunca replay del
/// historial), recompilar y escribir el plan restaurado en el `SceneRuntime`
/// vía `replace_active_plan`. Historial vacío → 409 (spec "Undo with empty
/// history"). El inverse ya fue capturado en el apply (PR4) — este endpoint
/// lo consume sin re-derivarlo.
pub async fn undo_command(State(state): State<Arc<AppState>>) -> ApiResult<UndoResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // 1. Plan activo — la fuente del programa semántico (I1/I2).
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to undo".to_string(),
            code: "no_active_plan".to_string(),
        })?;

    let program = {
        let segments = active_plan.segments.as_deref().ok_or_else(|| {
            ApiError::InvalidState {
                message: "Active plan carries no program segments".to_string(),
                code: "no_program_segments".to_string(),
            }
        })?;
        if segments.is_empty() {
            return Err(ApiError::InvalidState {
                message: "Active plan has no program segments".to_string(),
                code: "no_program_segments".to_string(),
            });
        }
        PlanningProgram::new(segments.iter().map(|s| s.source.clone()).collect())
    };

    // 2. Peek del último comando aplicado (O(1)) — su inverse es el que
    //    recompila el plan restaurado. Historial vacío → 409 ANTES de tocar
    //    nada (spec "Undo with empty history").
    let entry = state
        .services
        .scene
        .last_applied()
        .await
        .ok_or_else(|| ApiError::Conflict {
            message: "No applied command to undo".to_string(),
            code: "empty_command_history".to_string(),
        })?;

    // 3. Aplicar el inverse ALMACENADO una sola vez (D6 — nunca replay).
    let restored_program = entry
        .undo_program(&program)
        .map_err(|e| ApiError::Validation {
            message: e.to_string(),
            code: "inverse_apply_failed".to_string(),
        })?;

    // 4. Recompilar desde el mismo estado inicial que el plan activo (mismo
    //    start que preview/apply — el programa restaurado es el previo al
    //    comando deshecho).
    let fk = ForwardKinematics::new(snapshot.chain.clone());
    let solver =
        DampedLeastSquaresSolver::new(fk, snapshot.resolve_default_frame(), 500, 1e-6, 0.1);
    let start_joints = active_plan
        .trajectory
        .waypoints()
        .first()
        .map(|w| w.joints().to_vec())
        .unwrap_or_else(|| snapshot.joints.clone());
    let current_state = RobotState::new(start_joints);
    let ctx = SegmentPlanningContext {
        robot: &snapshot.chain,
        current_state: &current_state,
        ik_solver: &solver,
        tcp: snapshot.active_tcp.as_ref(),
    };
    let compiled = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()))
        .compile(&restored_program, &ctx)
        .map_err(|e| ApiError::Validation {
            message: e.to_string(),
            code: "recompile_failed".to_string(),
        })?;

    // 5. WRITE-BACK atómico (D4/D5): pop (O(1)) + replace_active_plan — el
    //    entry devuelto es el REALMENTE deshecho (métricas del response).
    let (popped, restored_snapshot) = state.services.scene.undo_compiled_plan(compiled).await?;

    // 6. Salud restaurada desde las métricas almacenadas (O(1) — sin re-análisis).
    let health_before = popped.metrics.health_after;
    let health_after = popped.metrics.health_before;

    Ok(Json(UndoResponse {
        plan_id: restored_snapshot
            .active_plan
            .as_ref()
            .map(|p| p.plan_id.clone())
            .unwrap_or_default(),
        health_before,
        health_after,
        improvement: health_after - health_before,
        history_length: state.services.scene.history_len().await,
    }))
}

// ── Metrics helpers ──────────────────────────────────────────

/// Compute the minimum distance from any joint to its nearest mechanical
/// limit across all waypoints.
fn compute_min_joint_margin(
    traj: &thalos_core::trajectory::Trajectory,
    limits: &[(f64, f64)],
) -> f64 {
    traj.waypoints()
        .iter()
        .flat_map(|wp| {
            wp.joints()
                .iter()
                .zip(limits.iter())
                .map(|(q, (lo, hi))| (q - lo).abs().min((hi - q).abs()))
        })
        .fold(f64::INFINITY, f64::min)
}

/// Compute the maximum joint velocity across all segments.
fn compute_max_velocity(traj: &thalos_core::trajectory::Trajectory) -> f64 {
    let wps = traj.waypoints();
    if wps.len() < 2 {
        return 0.0;
    }
    let mut max_v = 0.0;
    for i in 0..wps.len() - 1 {
        let dt = wps[i + 1].timestamp() - wps[i].timestamp();
        if dt <= 0.0 {
            continue;
        }
        let max_dq: f64 = wps[i + 1]
            .joints()
            .iter()
            .zip(wps[i].joints().iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f64::max);
        let v = max_dq / dt;
        if v > max_v {
            max_v = v;
        }
    }
    max_v
}

/// Compute the maximum L2 joint-space distance between consecutive waypoints.
fn compute_max_segment_error(traj: &thalos_core::trajectory::Trajectory) -> f64 {
    let wps = traj.waypoints();
    if wps.len() < 2 {
        return 0.0;
    }
    let mut max_err = 0.0;
    for i in 0..wps.len() - 1 {
        let err: f64 = wps[i]
            .joints()
            .iter()
            .zip(wps[i + 1].joints().iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        if err > max_err {
            max_err = err;
        }
    }
    max_err
}

// ── Optimize handler ─────────────────────────────────────────

/// POST /api/v1/plan/optimize
pub async fn handle_optimize(State(state): State<Arc<AppState>>) -> ApiResult<OptimizeResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // 1. Get active plan trajectory
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to optimize".to_string(),
            code: "no_active_plan".to_string(),
        })?;
    let trajectory = &active_plan.trajectory;
    // I3: observaciones ancladas al MotionPlan analizado.
    let artifact = ArtifactRef::MotionPlan(MotionPlanId(active_plan.plan_id.clone()));

    // 2. Run PlanAnalysis (same as analyze) — reporte canónico + métricas
    let analysis_result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact,
    )?;

    // 3. Detect problem regions — el dueño único de la agrupación es el
    //    RegionGrouper, sobre las observaciones del reporte canónico.
    let regions = RegionGrouper::default().group(&analysis_result.report.observations);

    let before_metrics = &analysis_result.analysis.metrics;
    let before_health = analysis_result.report.summary.quality_index;

    // 4. Extract joint limits from the chain (actuated joints only)
    let chain_joints: Vec<(f64, f64)> = snapshot
        .chain
        .segments
        .iter()
        .filter(|s| s.joint.dof() > 0)
        .map(|s| {
            let limits = s.joint.limits();
            if limits.enabled {
                (limits.min, limits.max)
            } else {
                (-std::f64::consts::PI, std::f64::consts::PI)
            }
        })
        .collect();

    let (lower, upper): (Vec<f64>, Vec<f64>) = chain_joints.iter().cloned().unzip();

    // 5. Build OptimizationContext
    let ctx = OptimizationContext {
        joint_limits: JointLimits {
            lower,
            upper,
            velocity: None,
            acceleration: None,
        },
        config: PipelineConfig::default(),
        tool_frame: snapshot
            .active_tcp
            .as_ref()
            .map(|tcp| tcp.base_frame.clone()),
    };

    // 6. Build PlanMetrics for operator scoring
    let plan_metrics = {
        use thalos_core::evaluation::{
            CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics,
        };
        PlanMetrics::new(
            0.0, // length — not used for scoring
            before_metrics.waypoint_count,
            ManipulabilityMetrics::new(
                before_metrics.min_manipulability.unwrap_or(0.0),
                before_metrics.avg_manipulability.unwrap_or(0.0),
                before_metrics.near_singular_count,
                before_metrics.singular_count,
            ),
            JointSafetyMetrics::new(0.0, 0.0, 0),
            CollisionMetrics::new(1.0, 0, 0),
            0.0, // smoothness
            0.0, // orientation change
        )
    };

    // 7. Create all 5 operators with default parameters
    let operators: Vec<Box<dyn TrajectoryOperator>> = vec![
        Box::new(JointCenteringOperator::new(
            JointCenteringOperator::DEFAULT_FACTOR,
        )),
        Box::new(Retime::new(
            Retime::DEFAULT_VELOCITY,
            Retime::DEFAULT_MAX_DURATION_SCALE,
        )),
        Box::new(AdaptiveSampling::new(
            AdaptiveSampling::DEFAULT_MAX_POINTS,
            AdaptiveSampling::DEFAULT_ERROR_THRESHOLD,
            AdaptiveSampling::DEFAULT_CURVATURE_THRESHOLD,
            AdaptiveSampling::DEFAULT_MIN_SEGMENT_LENGTH,
        )),
        Box::new(NullSpaceOptimization::new(
            NullSpaceOptimization::DEFAULT_FACTOR,
            NullSpaceOptimization::DEFAULT_TOLERANCE,
            NullSpaceOptimization::DEFAULT_DT,
        )),
        Box::new(OrientationRelaxation::new(
            OrientationRelaxation::DEFAULT_MAX_ANGLE,
            OrientationRelaxation::DEFAULT_TOLERANCE,
            OrientationRelaxation::DEFAULT_DT,
            OrientationRelaxation::DEFAULT_POSITION_TOLERANCE,
        )),
    ];

    // Create refs for the pipeline (takes &[&dyn TrajectoryOperator])
    let operator_refs: Vec<&dyn TrajectoryOperator> =
        operators.iter().map(|op| op.as_ref()).collect();

    // 8. Run OptimizationPipeline
    let pipeline = OptimizationPipeline::new(PipelineConfig::default());
    let pipeline_result = pipeline
        .optimize(
            &operator_refs,
            &snapshot.chain,
            trajectory,
            &regions,
            &plan_metrics,
            &ctx,
            None,
        )
        .map_err(|e| ApiError::Internal {
            message: format!("Optimization pipeline failed: {}", e),
        })?;

    // 9. Analyze the optimized trajectory
    let after_trajectory = &pipeline_result.trajectory;
    let after_analysis = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        after_trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        ArtifactRef::MotionPlan(MotionPlanId(
            snapshot
                .active_plan
                .as_ref()
                .map(|p| p.plan_id.clone())
                .unwrap_or_default(),
        )),
    )?;

    let after_health = after_analysis.report.summary.quality_index;
    let after_metrics = &after_analysis.analysis.metrics;

    // 10. Extract operator report from pipeline steps
    let operators_applied: Vec<OperatorAppliedDto> = pipeline_result
        .report
        .steps
        .iter()
        .map(|step| {
            let family = match step.operator_id {
                "joint_centering" => "JointSpace",
                "retime" => "Temporal",
                "adaptive_sampling" => "Sampling",
                "nullspace_optimization" => "JointSpace",
                "orientation_relaxation" => "Geometry",
                _ => "Unknown",
            };
            let status = if step.accepted { "applied" } else { "failed" };
            OperatorAppliedDto {
                id: step.operator_id.to_string(),
                family: family.to_string(),
                status: status.to_string(),
            }
        })
        .collect();

    // 11. Compute before/after metrics
    let manip_before = before_metrics.avg_manipulability.unwrap_or(0.0);
    let manip_after = after_metrics.avg_manipulability.unwrap_or(0.0);

    let joint_margin_before = compute_min_joint_margin(trajectory, &chain_joints);
    let joint_margin_after = compute_min_joint_margin(after_trajectory, &chain_joints);

    let max_vel_before = compute_max_velocity(trajectory);
    let max_vel_after = compute_max_velocity(after_trajectory);

    let max_seg_err_before = compute_max_segment_error(trajectory);
    let max_seg_err_after = compute_max_segment_error(after_trajectory);

    // 12. Compute optimized trajectory positions for 3D overlay
    let fk = ForwardKinematics::new(snapshot.chain.clone());
    let optimized_positions: Vec<[f64; 3]> = after_trajectory
        .waypoints()
        .iter()
        .filter_map(|wp| {
            let result = fk.evaluate(wp.joints());
            result.ee_position().map(|p| [p.x, p.y, p.z])
        })
        .collect();

    Ok(Json(OptimizeResponse {
        health_before: before_health,
        health_after: after_health,
        operators_applied,
        optimized_positions,
        metrics: MetricsComparisonDto {
            manipulability_before: manip_before,
            manipulability_after: manip_after,
            joint_margin_before,
            joint_margin_after,
            max_velocity_before: max_vel_before,
            max_velocity_after: max_vel_after,
            max_segment_error_before: max_seg_err_before,
            max_segment_error_after: max_seg_err_after,
        },
    }))
}
