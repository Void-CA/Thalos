//! DTOs para el endpoint de análisis de planes.
//!
//! PR 7a: el wire format de `POST /plan/analyze` es la PROYECCIÓN del
//! [`AnalysisReport`] del dominio (spec `motion-plan-endpoint`):
//!
//! ```json
//! {
//!   "artifact": { "kind": "MotionPlan", "id": "mp-1" },
//!   "observations": [ ... kind/severity/artifact/location/attributes (I2) ... ],
//!   "actions": [ ... target_observation (I5) ... ],
//!   "metrics": { ... },
//!   "summary": { "quality_index": 0.85, "score": 85, "grade": "Good", ... },
//!   "problem_regions": [ ... ]   // contrato legacy, vía ProblemRegionsDtoAdapter
//! }
//! ```
//!
//! Dirección ÚNICA dominio → DTO (spec I6): el dominio no cambia por el wire;
//! el DTO proyecta. `problem_regions` es una representación pública heredada
//! del contrato — se proyecta desde las [`ProblemRegion`] del dominio
//! (producidas por el [`RegionGrouper`], dueño único de la agrupación), nunca
//! un modelo paralelo.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thalos_core::{
    analysis::{
        RegionGrouper,
        action::Action,
        attribute_value::AttributeValue,
        location::Location,
        observation::{ArtifactRef, Observation},
        region::{ProblemRegion, SemanticProblem, project_semantic_problem},
        report::AnalysisReport,
        summary::AnalysisSummary,
    },
    ids::{ExecutionSessionId, MotionPlanId, RobotId, SceneId, SemanticProgramId, TaskDocumentId},
    operation::MotionProvenance,
};
use thalos_planning::motion::program::PlannedSegment;

/// Request para analizar un plan activo.
#[derive(Debug, Deserialize)]
pub struct PlanAnalysisRequest {
    /// ID del plan activo a analizar (opcional — si no se especifica,
    /// analiza el plan activo del runtime).
    pub plan_id: Option<String>,
}

/// Respuesta completa del análisis de un plan — proyección del
/// [`AnalysisReport`] del dominio (spec motion-plan-endpoint).
#[derive(Debug, Serialize)]
pub struct PlanAnalysisResponse {
    /// Ancla del reporte (I3): kind + identificador real del artefacto
    /// analizado (O3: se expone el id disponible — `plan_id`).
    pub artifact: ArtifactDto,
    /// Observaciones canónicas, machine-readable (I2).
    pub observations: Vec<ObservationDto>,
    /// Acciones de remediación referenciando observaciones por id (I5).
    pub actions: Vec<ActionDto>,
    /// Métricas agregadas del reporte (claves estables del dominio).
    pub metrics: BTreeMap<String, f64>,
    /// Resumen derivado: quality_index + score (×100) + grade + distribución.
    pub summary: SummaryDto,
    /// Regiones problemáticas — representación pública heredada del contrato,
    /// proyectada desde el dominio vía `ProblemRegionsDtoAdapter`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problem_regions: Vec<ProblemRegionDto>,
}

impl PlanAnalysisResponse {
    /// Proyección pura `AnalysisReport → PlanAnalysisResponse`.
    ///
    /// Las regiones se derivan de las observaciones del reporte con el
    /// [`RegionGrouper`] (dueño único de la agrupación) y se proyectan al
    /// campo legacy `problem_regions` con el adapter de DTO. Nunca al revés.
    pub fn from_report(report: &AnalysisReport, segments: &[PlannedSegment]) -> Self {
        let regions = RegionGrouper::default().group(&report.observations);
        Self {
            artifact: ArtifactDto::from(&report.artifact),
            observations: report
                .observations
                .iter()
                .map(ObservationDto::from)
                .collect(),
            actions: report.actions.iter().map(ActionDto::from).collect(),
            metrics: report.metrics.clone(),
            summary: SummaryDto::from(&report.summary),
            problem_regions: ProblemRegionsDtoAdapter::from_regions(&regions, segments),
        }
    }
}

/// Ancla de artefacto en el wire — kind + id real (O3).
#[derive(Debug, Serialize)]
pub struct ArtifactDto {
    /// Tipo de artefacto ("MotionPlan", "ExecutionSession", …).
    pub kind: String,
    /// Identificador disponible del artefacto (ej: `plan_id`).
    pub id: String,
}

impl From<&ArtifactRef> for ArtifactDto {
    fn from(artifact: &ArtifactRef) -> Self {
        match artifact {
            ArtifactRef::Robot(RobotId(id)) => Self::new("Robot", id),
            ArtifactRef::Scene(SceneId(id)) => Self::new("Scene", id),
            ArtifactRef::SemanticProgram(SemanticProgramId(id)) => Self::new("SemanticProgram", id),
            ArtifactRef::TaskDocument(TaskDocumentId(id)) => Self::new("TaskDocument", id),
            ArtifactRef::MotionPlan(MotionPlanId(id)) => Self::new("MotionPlan", id),
            ArtifactRef::ExecutionSession(ExecutionSessionId(id)) => {
                Self::new("ExecutionSession", id)
            }
            // #[non_exhaustive]: artifact kinds añadidos al modelo quedan
            // cubiertos por este fallback documentado hasta extender el DTO
            // (O3: id vacío = placeholder temporal explícito).
            _ => Self::new("Artifact", ""),
        }
    }
}

impl ArtifactDto {
    fn new(kind: &str, id: &str) -> Self {
        Self {
            kind: kind.to_string(),
            id: id.to_string(),
        }
    }
}

/// Observación canónica proyectada al wire (I2): kind/severity/artifact/
/// location identifican el fenómeno sin parsing de texto.
#[derive(Debug, Serialize)]
pub struct ObservationDto {
    /// Id de la observación dentro del reporte (asignado por el aggregator).
    pub id: u32,
    /// Fenómeno observado, machine-readable ("NearSingularity", …).
    pub kind: String,
    /// Severidad ("Error", "Warning", "Info").
    pub severity: String,
    /// Ancla del artefacto (I3).
    pub artifact: ArtifactDto,
    /// Dónde ocurre el fenómeno (enum externally-tagged: {"Waypoint": 5}).
    pub location: Location,
    /// Atributos tipados (D5), claves estables.
    pub attributes: BTreeMap<String, AttributeValue>,
    /// Observaciones causantes (I4, ids del reporte).
    pub causes: Vec<u32>,
    /// Observaciones relacionadas sin dirección causal.
    pub related: Vec<u32>,
}

impl From<&Observation> for ObservationDto {
    fn from(o: &Observation) -> Self {
        Self {
            id: o.id.0,
            kind: format!("{:?}", o.kind),
            severity: format!("{:?}", o.severity),
            artifact: ArtifactDto::from(&o.artifact),
            location: o.location.clone(),
            attributes: o.attributes.clone(),
            causes: o.causes.iter().map(|id| id.0).collect(),
            related: o.related.iter().map(|id| id.0).collect(),
        }
    }
}

/// Acción de remediación proyectada al wire (I5): referencia la observación
/// objetivo por id, nunca embebida.
#[derive(Debug, Serialize)]
pub struct ActionDto {
    /// Id de la acción dentro del reporte.
    pub id: u32,
    /// Tipo de remediación ("Singularity", "Manipulability", …).
    pub kind: String,
    /// Id de la observación que remedía (I5).
    pub target_observation: u32,
    /// Prioridad ("High", "Medium", "Low").
    pub priority: String,
    /// Impacto esperado ("High", "Medium", "Low").
    pub impact: String,
    /// Parámetros tipados de la remediación (D5).
    pub parameters: BTreeMap<String, AttributeValue>,
}

impl From<&Action> for ActionDto {
    fn from(a: &Action) -> Self {
        Self {
            id: a.id.0,
            kind: format!("{:?}", a.kind),
            target_observation: a.target_observation.0,
            priority: format!("{:?}", a.priority),
            impact: format!("{:?}", a.impact),
            parameters: a.parameters.clone(),
        }
    }
}

/// Resumen derivado proyectado al wire.
///
/// `quality_index` (0..1) es la ÚNICA medida agregada de calidad (I7); `score`
/// es la proyección de presentación `quality_index × 100` (spec
/// motion-plan-endpoint "DTO projection of quality_index").
#[derive(Debug, Serialize)]
pub struct SummaryDto {
    /// Medida única de calidad del dominio (0..1, I7).
    pub quality_index: f64,
    /// Proyección de presentación: quality_index × 100.
    pub score: u32,
    /// Etiqueta cualitativa: "Excellent", "Good", "Fair", "Poor".
    pub grade: String,
    /// Cantidad de observaciones del reporte.
    pub observation_count: usize,
    /// Conteo de observaciones por severidad (machine-readable).
    pub severity_distribution: BTreeMap<String, usize>,
}

impl From<&AnalysisSummary> for SummaryDto {
    fn from(summary: &AnalysisSummary) -> Self {
        let score = ((summary.quality_index * 100.0).round() as u32).min(100);
        let severity_distribution = summary
            .severity_distribution
            .iter()
            .map(|(severity, count)| (format!("{severity:?}"), *count))
            .collect();
        Self {
            quality_index: summary.quality_index,
            score,
            grade: format!("{:?}", summary.grade),
            observation_count: summary.observation_count,
            severity_distribution,
        }
    }
}

// ─── problem_regions (representación pública heredada del contrato) ───

/// Métricas de una región problemática.
#[derive(Debug, Serialize)]
pub struct RegionMetricsDto {
    pub waypoint_count: usize,
    pub average_value: Option<f64>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub error_count: usize,
    pub warning_count: usize,
}

/// Explicación de una región problemática.
#[derive(Debug, Serialize)]
pub struct ExplanationDto {
    pub cause: String,
    pub consequence: String,
    pub recommended_strategies: Vec<String>,
    pub confidence: f64,
}

/// Región problemática semántica (M8.1+).
#[derive(Debug, Serialize)]
pub struct ProblemRegionDto {
    pub id: usize,
    pub kind: String,
    pub severity: String,
    pub waypoint_start: usize,
    pub waypoint_end: usize,
    pub waypoint_count: usize,
    pub metrics: Option<RegionMetricsDto>,
    pub explanation: ExplanationDto,
    pub confidence: Option<f64>,
    pub recommended_strategies: Vec<String>,
    /// Operación semántica que originó la región (PR 3). Presente solo cuando
    /// el plan fue compilado desde el IR de operaciones y la región se mapea a
    /// un segmento con provenance; `None` en el camino legacy (segments).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic: Option<SemanticProblemDto>,
}

/// Contexto de operación de una región problemática (PR 3).
///
/// Puente entre los rangos de waypoint de bajo nivel y la intención de la
/// operación que los originó, para consumo del frontend.
#[derive(Debug, Serialize)]
pub struct SemanticProblemDto {
    /// ID de la operación que originó la región (legible en JSON).
    pub operation_id: Option<String>,
    /// Rol de compilación dentro de la operación (approach, execution, …).
    pub role: Option<String>,
    /// Tipo de problema (heredado de la región origen).
    pub kind: String,
    /// Severidad del problema (heredada de la región origen).
    pub severity: String,
}

impl From<&SemanticProblem> for SemanticProblemDto {
    fn from(problem: &SemanticProblem) -> Self {
        Self {
            operation_id: problem.operation_id.as_ref().map(|id| id.to_string()),
            role: problem
                .role
                .as_ref()
                .map(|r| format!("{:?}", r).to_lowercase()),
            kind: problem.kind.name().to_string(),
            severity: format!("{:?}", problem.severity).to_lowercase(),
        }
    }
}

/// Adapter de DTO: `ProblemRegion (dominio) → ProblemRegionDto (wire legacy)`.
///
/// Dirección ÚNICA dominio → DTO. NO contiene lógica de agrupación (esa vive
/// en el [`RegionGrouper`], dueño único) — solo conversión de forma y
/// proyección semántica (provenance de operaciones) sobre las regiones que
/// recibe. NUNCA un modelo paralelo: el dominio habla observaciones; este
/// adapter es el punto donde la representación pública heredada se deriva.
pub struct ProblemRegionsDtoAdapter;

impl ProblemRegionsDtoAdapter {
    /// Proyecta regiones del dominio al DTO legacy `problem_regions`.
    pub fn from_regions(
        regions: &[ProblemRegion],
        segments: &[PlannedSegment],
    ) -> Vec<ProblemRegionDto> {
        let provenance = build_provenance(segments);
        regions
            .iter()
            .map(|region| {
                let mut dto = to_problem_region_dto(region);
                dto.semantic = (!provenance.is_empty())
                    .then(|| {
                        SemanticProblemDto::from(&project_semantic_problem(region, &provenance))
                    })
                    .filter(|semantic| semantic.operation_id.is_some() || semantic.role.is_some());
                dto
            })
            .collect()
    }
}

fn to_problem_region_dto(region: &ProblemRegion) -> ProblemRegionDto {
    let metrics = region.metrics.as_ref().map(|m| RegionMetricsDto {
        waypoint_count: m.waypoint_count,
        average_value: m.average_value,
        min_value: m.min_value,
        max_value: m.max_value,
        error_count: m.error_count,
        warning_count: m.warning_count,
    });

    let explanation = region
        .explanation
        .as_ref()
        .map(|e| ExplanationDto {
            cause: e.cause.clone(),
            consequence: e.consequence.clone(),
            recommended_strategies: e.recommended_strategies.clone(),
            confidence: e.confidence,
        })
        .unwrap_or(ExplanationDto {
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
        semantic: None,
    }
}

/// Rebuild provenance from the active plan's segments.
///
/// `compile_with_operations()` records one `MotionProvenance` per expanded
/// node/segment; the runtime persists the compiled `PlannedSegment`s
/// (with `operation_id` + `role`), so the projection input is recovered
/// from them without storing a separate structure. Legacy segments carry
/// `None` metadata and yield no provenance.
fn build_provenance(segments: &[PlannedSegment]) -> Vec<MotionProvenance> {
    segments
        .iter()
        .filter_map(|s| {
            s.operation_id.clone().map(|operation_id| MotionProvenance {
                waypoint_range: s.waypoint_range.clone(),
                operation_id,
                role: s
                    .role
                    .unwrap_or(thalos_core::operation::MotionRole::Transit),
            })
        })
        .collect()
}

// ─── Optimization response DTOs ─────────────────────────────────────

/// One-shot optimization report.
#[derive(Debug, Serialize)]
pub struct OptimizeResponse {
    /// Health score before optimization (0..1).
    pub health_before: f64,
    /// Health score after optimization (0..1).
    pub health_after: f64,
    /// Operators that were applied (one per problem region).
    pub operators_applied: Vec<OperatorAppliedDto>,
    /// Metrics comparison before vs after.
    pub metrics: MetricsComparisonDto,
    /// Optimized trajectory positions [[x,y,z], ...] for 3D overlay.
    pub optimized_positions: Vec<[f64; 3]>,
}

/// Status of an operator applied to one problem region.
#[derive(Debug, Serialize)]
pub struct OperatorAppliedDto {
    /// Operator identifier, e.g. "joint_centering".
    pub id: String,
    /// Operator family, e.g. "JointSpace".
    pub family: String,
    /// Whether the operator was applied, rejected, or failed.
    pub status: String,
}

/// Before/after metrics comparison.
#[derive(Debug, Serialize)]
pub struct MetricsComparisonDto {
    pub manipulability_before: f64,
    pub manipulability_after: f64,
    pub joint_margin_before: f64,
    pub joint_margin_after: f64,
    pub max_velocity_before: f64,
    pub max_velocity_after: f64,
    pub max_segment_error_before: f64,
    pub max_segment_error_after: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;
    use thalos_core::{
        analysis::{
            region::{RegionId, RegionKind, RegionSeverity, SemanticProblem},
            report::AnalysisReport,
            summary::{AnalysisSummary, Grade},
        },
        operation::{MotionRole, OperationId},
    };
    use thalos_planning::motion::program::PlannedSegment;

    #[test]
    fn semantic_problem_dto_serializes_with_operation_context() {
        let problem = SemanticProblem {
            operation_id: Some(OperationId("42".to_string())),
            role: Some(MotionRole::Execution),
            kind: RegionKind::Singularity,
            severity: RegionSeverity::Critical,
            waypoint_range: 5..10,
        };

        let value = serde_json::to_value(SemanticProblemDto::from(&problem)).unwrap();
        assert_eq!(value["operation_id"], "42");
        assert_eq!(value["role"], "execution");
        assert_eq!(value["kind"], "singularity");
        assert_eq!(value["severity"], "critical");
    }

    #[test]
    fn semantic_problem_dto_without_context_serializes_none_fields() {
        let problem = SemanticProblem {
            operation_id: None,
            role: None,
            kind: RegionKind::Velocity,
            severity: RegionSeverity::Info,
            waypoint_range: 0..3,
        };

        let value = serde_json::to_value(SemanticProblemDto::from(&problem)).unwrap();
        assert!(value["operation_id"].is_null());
        assert!(value["role"].is_null());
        assert_eq!(value["kind"], "velocity");
        assert_eq!(value["severity"], "info");
    }

    // ─── PR 7a: wire format projects the canonical AnalysisReport ─────────
    //
    // Spec `motion-plan-endpoint` "AnalysisResponse Wire Format": POST
    // /plan/analyze returns the AnalysisReport projection —
    // observations[]/actions[]/metrics[]/summary — with machine-readable
    // observations (I2) and quality_index × 100 → score.

    fn sample_report() -> AnalysisReport {
        use thalos_core::analysis::action::{
            Action, ActionId, ActionImpact, ActionKind, ActionPriority,
        };
        use thalos_core::analysis::attribute_value::AttributeValue;
        use thalos_core::analysis::location::Location;
        use thalos_core::analysis::observation::{
            ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
        };
        use thalos_core::ids::MotionPlanId;

        let artifact = ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string()));
        let mut attributes = BTreeMap::new();
        attributes.insert("value".to_string(), AttributeValue::Number(0.12));
        attributes.insert("threshold".to_string(), AttributeValue::Number(0.05));
        let observations = vec![
            Observation {
                id: ObservationId(1),
                kind: ObservationKind::NearSingularity,
                severity: Severity::Error,
                artifact: artifact.clone(),
                location: Location::Waypoint(0),
                attributes: attributes.clone(),
                causes: Vec::new(),
                related: Vec::new(),
            },
            Observation {
                id: ObservationId(2),
                kind: ObservationKind::NearSingularity,
                severity: Severity::Error,
                artifact: artifact.clone(),
                location: Location::Waypoint(1),
                attributes,
                causes: Vec::new(),
                related: Vec::new(),
            },
        ];
        let actions = vec![Action {
            id: ActionId(1),
            kind: ActionKind::Singularity,
            target_observation: ObservationId(1),
            priority: ActionPriority::High,
            impact: ActionImpact::High,
            parameters: BTreeMap::new(),
        }];
        let mut metrics = BTreeMap::new();
        metrics.insert("manipulability".to_string(), 0.5_f64);
        let mut severity_distribution = BTreeMap::new();
        severity_distribution.insert(Severity::Error, 2usize);
        AnalysisReport {
            artifact,
            observations,
            actions,
            metrics,
            summary: AnalysisSummary {
                quality_index: 0.4,
                observation_count: 2,
                severity_distribution,
                grade: Grade::Poor,
            },
        }
    }

    #[test]
    fn analysis_response_projects_report_wire_shape() {
        // Spec "AnalysisReport wire format": the response SHALL contain
        // observations[]/actions[]/metrics[]/summary.
        let report = sample_report();
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &segments);
        let value = serde_json::to_value(response).expect("serialize");
        let obj = value.as_object().expect("object");
        for field in ["observations", "actions", "metrics", "summary"] {
            assert!(obj.contains_key(field), "response must carry `{field}`");
        }
        assert!(obj["observations"].is_array());
        assert!(obj["actions"].is_array());
        assert!(obj["metrics"].is_object());
        assert!(obj["summary"].is_object());
        // Legacy contract field preserved during the transition; projection is
        // strictly domain → DTO (PR 7b will bridge old↔new shapes for cambio A).
        assert!(
            obj["problem_regions"].is_array(),
            "near-singular observations must project problem_regions (legacy contract)"
        );
    }

    #[test]
    fn near_singularity_observation_is_machine_readable() {
        // Spec "Machine-readable observations in wire (I2)": kind, severity,
        // artifact and location identify the phenomenon without text parsing.
        let obs = &sample_report().observations[0];
        let value = serde_json::to_value(ObservationDto::from(obs)).expect("serialize");
        let obj = value.as_object().expect("object");
        assert_eq!(obj["kind"], "NearSingularity");
        assert_eq!(obj["severity"], "Error");
        assert_eq!(obj["artifact"]["kind"], "MotionPlan");
        assert_eq!(obj["artifact"]["id"], "mp-1");
        assert_eq!(obj["location"], json!({"Waypoint": 0}));
        // I1: no presentation field leaks into the wire observation.
        for banned in ["message", "text", "icon", "label", "description"] {
            assert!(
                !obj.contains_key(banned),
                "observation must not carry presentation field `{banned}`"
            );
        }
        // D5: attributes keep their typed shape on the wire.
        assert_eq!(obj["attributes"]["value"], json!({"Number": 0.12}));
        assert_eq!(obj["attributes"]["threshold"], json!({"Number": 0.05}));
    }

    #[test]
    fn summary_projects_quality_index_times_100_as_score() {
        // Spec "DTO projection of quality_index": 0.85 → score 85; the domain
        // keeps quality_index as the single measure (I7).
        let mut severity_distribution = BTreeMap::new();
        severity_distribution.insert(
            thalos_core::analysis::observation::Severity::Warning,
            1usize,
        );
        let summary = AnalysisSummary {
            quality_index: 0.85,
            observation_count: 1,
            severity_distribution,
            grade: Grade::Good,
        };
        let value = serde_json::to_value(SummaryDto::from(&summary)).expect("serialize");
        let obj = value.as_object().expect("object");
        assert_eq!(
            obj["score"], 85,
            "quality_index 0.85 must project as score 85"
        );
        assert!((obj["quality_index"].as_f64().expect("quality_index") - 0.85).abs() < 1e-9);
        assert_eq!(obj["grade"], "Good");
        assert_eq!(obj["observation_count"], 1);
        assert_eq!(obj["severity_distribution"]["Warning"], 1);
    }

    #[test]
    fn action_projects_target_observation_id() {
        // Spec analysis-report-contract I5: actions reference observations by
        // id on the wire — never an embedded copy.
        let report = sample_report();
        let value = serde_json::to_value(ActionDto::from(&report.actions[0])).expect("serialize");
        let obj = value.as_object().expect("object");
        assert_eq!(obj["target_observation"], 1);
        assert_eq!(obj["kind"], "Singularity");
        assert_eq!(obj["priority"], "High");
        assert_eq!(obj["impact"], "High");
    }

    // ─── ProblemRegionsDtoAdapter (ported from the legacy handler mapper) ──

    fn segment_with_metadata(
        waypoint_range: std::ops::Range<usize>,
        operation_id: Option<OperationId>,
        role: Option<MotionRole>,
    ) -> PlannedSegment {
        use thalos_core::{motion::segment::MotionSegment, trajectory::Trajectory};
        PlannedSegment {
            origin: OperationId("origin".to_string()),
            source: MotionSegment::MoveJ {
                origin: OperationId("origin".to_string()),
                target: vec![0.0, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
            trajectory: Trajectory::new(vec![]),
            waypoint_range,
            time_range: 0.0..1.0,
            operation_id,
            role,
        }
    }

    #[test]
    fn from_regions_attaches_semantic_context() {
        let regions = vec![ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            5..10,
        )];
        let segments = vec![
            segment_with_metadata(0..5, None, None),
            segment_with_metadata(
                5..10,
                Some(OperationId("42".to_string())),
                Some(MotionRole::Execution),
            ),
        ];

        let dtos = ProblemRegionsDtoAdapter::from_regions(&regions, &segments);
        let semantic = dtos[0]
            .semantic
            .as_ref()
            .expect("region 5..10 must map to the segment carrying operation 42");
        assert_eq!(semantic.operation_id.as_deref(), Some("42"));
        assert_eq!(semantic.role.as_deref(), Some("execution"));
        assert_eq!(semantic.kind, "singularity");
        assert_eq!(semantic.severity, "critical");
    }

    #[test]
    fn from_regions_legacy_segments_have_no_semantic() {
        let regions = vec![ProblemRegion::new(
            RegionId(0),
            RegionKind::Velocity,
            RegionSeverity::Warning,
            0..5,
        )];
        let segments = vec![segment_with_metadata(0..5, None, None)];

        let dtos = ProblemRegionsDtoAdapter::from_regions(&regions, &segments);
        assert!(
            dtos[0].semantic.is_none(),
            "legacy segments (no operation_id) must not attach semantic context"
        );
    }

    #[test]
    fn semantic_projection_skips_regions_outside_provenance() {
        let regions = vec![
            ProblemRegion::new(
                RegionId(0),
                RegionKind::Singularity,
                RegionSeverity::Critical,
                5..10,
            ),
            ProblemRegion::new(
                RegionId(1),
                RegionKind::Velocity,
                RegionSeverity::Info,
                20..25,
            ),
        ];
        let segments = vec![segment_with_metadata(
            5..10,
            Some(OperationId("7".to_string())),
            Some(MotionRole::Interaction),
        )];

        let dtos = ProblemRegionsDtoAdapter::from_regions(&regions, &segments);
        let semantic = dtos[0]
            .semantic
            .as_ref()
            .expect("overlapping region must map to operation 7");
        assert_eq!(semantic.operation_id.as_deref(), Some("7"));
        assert_eq!(semantic.role.as_deref(), Some("interaction"));
        assert!(
            dtos[1].semantic.is_none(),
            "region with no overlapping provenance must have no semantic context"
        );
    }
}
