//! Handler para el endpoint de análisis de planes.
//!
//! POST /api/v1/plan/analyze
//!
//! Analiza el plan activo del runtime y retorna
//! summary + metrics + findings + recommendations + problem_regions.

use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_core::kinematics::forward::ForwardKinematics;
use thalos_optimization::{
    domain::{
        JointLimits, OptimizationContext, PipelineConfig, TrajectoryOperator,
    },
    operators::{
        AdaptiveSampling, JointCenteringOperator, NullSpaceOptimization,
        OrientationRelaxation, Retime,
    },
    pipeline::OptimizationPipeline,
    PlanMetrics,
};
use thalos_planning::analysis::region::{
    RegionDetector, RegionDetectorConfig,
};
use thalos_runtime::{PlanAnalysisService};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::plan_analysis::dto::{
    ExplanationDto, FindingDto, MetricsComparisonDto, MetricsDto, OperatorAppliedDto,
    OptimizeResponse, PlanAnalysisRequest, PlanAnalysisResponse, ProblemRegionDto,
    RecommendationDto, RegionMetricsDto, SummaryDto, WaypointAnalysisDto,
};

/// Mapper: ProblemRegion → ProblemRegionDto
mod mapper {
    use super::*;
    use thalos_planning::analysis::domain::ProblemRegion;

    pub fn to_problem_region_dto(region: &ProblemRegion) -> ProblemRegionDto {
        let metrics = region.metrics.as_ref().map(|m| RegionMetricsDto {
            waypoint_count: m.waypoint_count,
            average_value: m.average_value,
            min_value: m.min_value,
            max_value: m.max_value,
            error_count: m.error_count,
            warning_count: m.warning_count,
        });

        let explanation = region.explanation.as_ref().map(|e| ExplanationDto {
            cause: e.cause.clone(),
            consequence: e.consequence.clone(),
            recommended_strategies: e.recommended_strategies.clone(),
            confidence: e.confidence,
        }).unwrap_or(ExplanationDto {
            cause: String::new(),
            consequence: String::new(),
            recommended_strategies: vec![],
            confidence: 1.0,
        });

        ProblemRegionDto {
            id: region.id.0,
            kind: region.kind.name().to_string(),
            severity: format!("{:?}", region.severity).to_lowercase(),
            waypoint_start: region.waypoint_range.start,
            waypoint_end: region.waypoint_range.end.saturating_sub(1),
            waypoint_count: region.waypoint_range.len(),
            metrics,
            explanation,
            confidence: None,
            recommended_strategies: vec![],
        }
    }

    pub fn to_problem_regions(regions: &[ProblemRegion]) -> Vec<ProblemRegionDto> {
        regions.iter().map(to_problem_region_dto).collect()
    }
}

/// POST /api/v1/plan/analyze
pub async fn analyze_plan(
    State(state): State<Arc<AppState>>,
    Json(_req): Json<PlanAnalysisRequest>,
) -> ApiResult<PlanAnalysisResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // Obtener la trayectoria del plan activo
    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to analyze".to_string(),
            code: "no_active_plan".to_string(),
        })?;

    let result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None, // constraints opcionales
    )?;

    // M8.1: Detectar regiones problemáticas
    let detector = RegionDetector::new(RegionDetectorConfig::default());
    let analysis_report = detector.detect(&result.findings);

    let metrics = &result.analysis.metrics;
    let findings = &result.findings;

    Ok(Json(PlanAnalysisResponse {
        summary: SummaryDto::from_analysis(
            findings,
            metrics.has_collisions,
            metrics.avg_manipulability,
            metrics.singular_count,
        ),
        metrics: MetricsDto {
            duration: metrics.trajectory_duration,
            waypoint_count: metrics.waypoint_count,
            average_manipulability: metrics.avg_manipulability,
            near_singular_count: metrics.near_singular_count,
            singular_count: metrics.singular_count,
            min_collision_distance: metrics.min_collision_distance,
            has_collisions: metrics.has_collisions,
        },
        waypoints: result.analysis.waypoints.iter().map(WaypointAnalysisDto::from).collect(),
        findings: findings.iter().map(FindingDto::from).collect(),
        recommendations: result
            .recommendations
            .into_iter()
            .map(RecommendationDto::from)
            .collect(),
        problem_regions: mapper::to_problem_regions(&analysis_report.problem_regions),
        health_score: Some(analysis_report.health_score),
    }))
}

// ── Metrics helpers ──────────────────────────────────────────

/// Compute the minimum distance from any joint to its nearest mechanical
/// limit across all waypoints.
fn compute_min_joint_margin(traj: &thalos_core::trajectory::Trajectory, limits: &[(f64, f64)]) -> f64 {
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
pub async fn handle_optimize(
    State(state): State<Arc<AppState>>,
) -> ApiResult<OptimizeResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // 1. Get active plan trajectory
    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to optimize".to_string(),
            code: "no_active_plan".to_string(),
        })?;

    // 2. Run PlanAnalysis (same as analyze)
    let analysis_result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
    )?;

    // 3. Detect problem regions
    let detector = RegionDetector::new(RegionDetectorConfig::default());
    let analysis_report = detector.detect(&analysis_result.findings);

    let before_metrics = &analysis_result.analysis.metrics;
    let before_health = analysis_report.health_score;

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
            &analysis_report.problem_regions,
            &plan_metrics,
            &ctx,
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
    )?;

    let after_detector = RegionDetector::new(RegionDetectorConfig::default());
    let after_report = after_detector.detect(&after_analysis.findings);
    let after_health = after_report.health_score;
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
            let status = if step.accepted {
                "applied"
            } else {
                "failed"
            };
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
