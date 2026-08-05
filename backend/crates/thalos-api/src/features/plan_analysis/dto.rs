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
//!   "metrics": { "waypoint_count": 20, "avg_manipulability": 0.42, ... },
//!   "summary": { "quality_index": 0.85, "score": 85, "grade": "Good", ... },
//!   "problem_regions": [ ... ],   // contrato legacy, vía ProblemRegionsDtoAdapter
//!   "manipulability_series": [ { "waypoint": 0, "yoshikawa": 0.42 }, ... ]  // S1 (P3), opcional
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
use thalos_planning::analysis::PlanAnalysis;
use thalos_planning::motion::program::PlannedSegment;
use thalos_planning::program_edit::ProgramEdit;
use thalos_planning::recommendation::{Recommendation, RecommendationStatus};

/// Request para analizar un plan activo.
#[derive(Debug, Deserialize)]
pub struct PlanAnalysisRequest {
    /// ID del plan activo a analizar (opcional — si no se especifica,
    /// analiza el plan activo del runtime).
    pub plan_id: Option<String>,
}

/// Request para previsualizar el efecto de una recomendación (PR3).
///
/// `POST /plan/commands/preview` — simulación READ-ONLY: la edición se aplica
/// sobre un CLON del programa semántico, se recompila y se re-analiza; el
/// `SceneRuntime` nunca se muta (spec command-endpoints "Preview Endpoint").
#[derive(Debug, Deserialize)]
pub struct PreviewRequest {
    /// Id de la recomendación a simular (ids del advisor, 1-based).
    pub recommendation_id: u32,
}

/// Respuesta de la simulación de una recomendación (PR3).
///
/// Proyecta el resultado de `edit.apply(clone) + recompile + re-analyze`:
/// waypoints de la trayectoria editada (para el overlay 3D, mismo patrón que
/// `OptimizeResponse.optimized_positions`), métricas antes/después y la
/// continuidad de la trayectoria resultante.
#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    /// Id de la recomendación simulada (eco del request).
    pub recommendation_id: u32,
    /// Disponibilidad del edit: `"available"` | `"unavailable"` (D8). La
    /// simulación de un edit `unavailable` devuelve una trayectoria idéntica
    /// (edit neutro) — el consumidor decide si la muestra.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<RecommendationStatus>,
    /// Posiciones del efector final `[x, y, z]` de la trayectoria editada —
    /// fuente del overlay 3D (spec advisor-projection "Preview overlay reuse").
    pub waypoints: Vec<[f64; 3]>,
    /// Métricas agregadas del plan ANTES de la edición (claves estables del
    /// reporte canónico).
    pub metrics_before: BTreeMap<String, f64>,
    /// Métricas agregadas del plan DESPUÉS de aplicar la edición.
    pub metrics_after: BTreeMap<String, f64>,
    /// Calidad de salud (0..1) antes de la edición.
    pub health_before: f64,
    /// Calidad de salud (0..1) después de la edición.
    pub health_after: f64,
    /// Mejora de salud: `health_after - health_before` (negativo = degrada).
    pub improvement: f64,
    /// La trayectoria recompilada es continua: sin huecos y con timestamps
    /// estrictamente crecientes (compilación atómica, sin interrupciones).
    pub continuity: bool,
}

/// Request para aplicar una recomendación al runtime (PR4).
///
/// `POST /plan/commands/apply` — WRITE-BACK: la edición se aplica al programa
/// semántico, se recompila y el resultado se escribe en el `SceneRuntime` vía
/// `replace_active_plan` (design D4/D5: feature-flagged, snapshot + restore).
/// El preview NO es prerequisito (spec command-endpoints "Apply without prior
/// preview").
#[derive(Debug, Deserialize)]
pub struct ApplyRequest {
    /// Id de la recomendación a aplicar (ids del advisor, 1-based).
    pub recommendation_id: u32,
}

/// Respuesta de aplicar una recomendación (PR4).
///
/// Confirma el write-back: el nuevo `plan_id` activo, la salud antes/después y
/// el tamaño del historial de comandos aplicados (el inverse se almacena en
/// memoria para el undo O(1) de PR5, design D6).
#[derive(Debug, Serialize)]
pub struct ApplyResponse {
    /// Id de la recomendación aplicada (eco del request).
    pub recommendation_id: u32,
    /// Disponibilidad del edit: `"available"` | `"unavailable"` (D8). Un edit
    /// `unavailable` jamás se aplica — el handler lo rechaza explícitamente.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<RecommendationStatus>,
    /// Id del plan activo resultante (el write-back asignó un nuevo id).
    pub plan_id: String,
    /// Calidad de salud (0..1) antes de la edición.
    pub health_before: f64,
    /// Calidad de salud (0..1) después de la edición.
    pub health_after: f64,
    /// Mejora de salud: `health_after - health_before` (negativo = degrada).
    pub improvement: f64,
    /// Tamaño del historial de comandos aplicados (inverses almacenados para
    /// el undo de PR5).
    pub history_length: usize,
}

/// Respuesta completa del análisis de un plan — proyección del
/// [`AnalysisReport`] del dominio (spec motion-plan-endpoint).
#[derive(Debug, Serialize, Deserialize)]
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
    /// Serie de manipulabilidad por waypoint (P3, spec motion-plan-endpoint
    /// "Analysis DTO Includes Manipulability Series"): un punto
    /// `{waypoint, yoshikawa}` por waypoint analizado. ADITIVO — opcional en
    /// el wire (`#[serde(default)]` + omitido cuando vacío): los clientes
    /// existentes que no leen el campo siguen funcionando sin cambios (I3).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manipulability_series: Vec<ManipulabilityPointDto>,
    /// Recomendaciones de remediación (spec recommendation-model "Wire
    /// Contract"): cada una lleva `action` + `edit` (comando semántico de
    /// plan). ADITIVO — `#[serde(default)]` + omitido cuando vacío: los
    /// clientes antiguos (JSON sin el campo) deserializan a `[]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recommendations: Vec<RecommendationDto>,
}

impl PlanAnalysisResponse {
    /// Proyección pura `AnalysisReport + PlanAnalysis → PlanAnalysisResponse`.
    ///
    /// Las regiones se derivan de las observaciones del reporte con el
    /// [`RegionGrouper`] (dueño único de la agrupación) y se proyectan al
    /// campo legacy `problem_regions` con el adapter de DTO. Nunca al revés.
    ///
    /// `manipulability_series` es una PROYECCIÓN de `analysis.waypoints` (el
    /// análisis técnico ya computado por el runtime — P3): el DTO nunca
    /// recalcula manipulabilidad, solo la proyecta al wire.
    ///
    /// `recommendations` se proyecta tal cual desde el runtime (producidas por
    /// el `PlanAdvisor` sobre el plan activo) — el DTO solo cambia de forma.
    pub fn from_report(
        report: &AnalysisReport,
        analysis: &PlanAnalysis,
        segments: &[PlannedSegment],
        recommendations: &[Recommendation],
    ) -> Self {
        let regions = RegionGrouper::default().group(&report.observations);
        let manipulability_series = analysis
            .waypoints
            .iter()
            .filter_map(|w| {
                w.manipulability.as_ref().map(|m| ManipulabilityPointDto {
                    waypoint: w.index as u32,
                    yoshikawa: m.yoshikawa,
                })
            })
            .collect();
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
            manipulability_series,
            recommendations: recommendations
                .iter()
                .map(RecommendationDto::from)
                .collect(),
        }
    }
}

/// Punto de la serie de manipulabilidad por waypoint (P3).
///
/// `waypoint` es el índice 0-based del waypoint en el plan; `yoshikawa` es la
/// medida de manipulabilidad del análisis técnico (proyección, nunca
/// recomputada por el DTO).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct ManipulabilityPointDto {
    /// Índice del waypoint en el plan (0-based).
    pub waypoint: u32,
    /// Medida de manipulabilidad de Yoshikawa en ese waypoint.
    pub yoshikawa: f64,
}

/// Ancla de artefacto en el wire — kind + id real (O3).
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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

/// Recomendación de remediación proyectada al wire (spec recommendation-model
/// "New client deserialization"): `id`, `action` (remediación que referencia
/// la observación por id, I5) y `edit` (comando semántico de plan, D1).
///
/// `status` es opcional en el wire — `"available"` | `"unavailable"` (D8) —
/// omitido cuando no fue evaluado, para compatibilidad con clientes que no lo
/// conocen.
#[derive(Debug, Serialize, Deserialize)]
pub struct RecommendationDto {
    /// Id de la recomendación dentro del reporte.
    pub id: u32,
    /// La remediación que recomienda (id, kind, target_observation, …).
    pub action: ActionDto,
    /// El comando de plan que aplica la remediación (edit tipado, D3).
    pub edit: ProgramEdit,
    /// Disponibilidad del edit: `"available"` | `"unavailable"` (D8).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<RecommendationStatus>,
}

impl From<&Recommendation> for RecommendationDto {
    fn from(r: &Recommendation) -> Self {
        Self {
            id: r.id.0,
            action: ActionDto::from(&r.action),
            edit: r.edit.clone(),
            status: r.status,
        }
    }
}

/// Resumen derivado proyectado al wire.
///
/// `quality_index` (0..1) es la ÚNICA medida agregada de calidad (I7); `score`
/// es la proyección de presentación `quality_index × 100` (spec
/// motion-plan-endpoint "DTO projection of quality_index").
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
pub struct RegionMetricsDto {
    pub waypoint_count: usize,
    pub average_value: Option<f64>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub error_count: usize,
    pub warning_count: usize,
}

/// Explicación de una región problemática.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExplanationDto {
    pub cause: String,
    pub consequence: String,
    pub recommended_strategies: Vec<String>,
    pub confidence: f64,
}

/// Región problemática semántica (M8.1+).
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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
        let response =
            PlanAnalysisResponse::from_report(&report, &sample_analysis(0), &segments, &[]);
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

    // ─── S1: additive manipulability_series delta (P3, I3) ──────────────
    //
    // Spec `motion-plan-endpoint` "Analysis DTO Includes Manipulability
    // Series": the response SHALL include `manipulability_series` — one
    // `{waypoint, yoshikawa}` entry per analyzed waypoint — optional
    // (`#[serde(default)]`) and backward-compatible. The series is a pure
    // projection of `PlanAnalysis.waypoints[].manipulability` (the technical
    // analysis), never recomputed by the DTO.

    use thalos_core::kinematics::jacobian::manipulability::ManipulabilityReport;
    use thalos_planning::analysis::{AnalysisMetrics, WaypointAnalysis};

    /// `PlanAnalysis` con `count` waypoints, cada uno con manipulabilidad
    /// determinística `yoshikawa = 0.1 + i * 0.01` (i = índice del waypoint).
    fn sample_analysis(count: usize) -> PlanAnalysis {
        PlanAnalysis {
            waypoints: (0..count)
                .map(|i| WaypointAnalysis {
                    index: i,
                    timestamp: i as f64 * 0.5,
                    joints: vec![0.0, 0.0],
                    singularity: None,
                    manipulability: Some(ManipulabilityReport {
                        yoshikawa: 0.1 + i as f64 * 0.01,
                        isotropy: 1.0,
                    }),
                    min_collision_distance: None,
                })
                .collect(),
            metrics: AnalysisMetrics {
                waypoint_count: count,
                trajectory_duration: 0.0,
                avg_manipulability: None,
                min_manipulability: None,
                near_singular_count: 0,
                singular_count: 0,
                min_collision_distance: None,
                min_collision_waypoint: None,
                has_collisions: false,
                first_collision_waypoint: None,
            },
            constraint_violations: Vec::new(),
        }
    }

    #[test]
    fn manipulability_series_projects_one_entry_per_waypoint() {
        // Spec "Series populated": a 20-waypoint plan → 20 entries, each with
        // waypoint (0..19) and the backend-computed yoshikawa value.
        let report = sample_report();
        let analysis = sample_analysis(20);
        let segments: Vec<PlannedSegment> = Vec::new();

        let value = serde_json::to_value(PlanAnalysisResponse::from_report(
            &report,
            &analysis,
            &segments,
            &[],
        ))
        .expect("serialize");
        let series = value["manipulability_series"]
            .as_array()
            .expect("manipulability_series must be an array");
        assert_eq!(series.len(), 20, "20 waypoints → 20 series entries");
        assert_eq!(series[0]["waypoint"], 0);
        assert!((series[0]["yoshikawa"].as_f64().expect("f64") - 0.1).abs() < 1e-12);
        assert_eq!(series[19]["waypoint"], 19);
        assert!(
            (series[19]["yoshikawa"].as_f64().expect("f64") - (0.1 + 19.0 * 0.01)).abs() < 1e-12
        );
    }

    #[test]
    fn manipulability_series_round_trips_preserving_values() {
        // Serde round-trip: 20 entries survive serialize → deserialize with
        // exact waypoint/yoshikawa values (contract fidelity for the chart).
        let report = sample_report();
        let analysis = sample_analysis(20);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[]);

        let json = serde_json::to_string(&response).expect("serialize");
        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.manipulability_series.len(), 20);
        assert_eq!(back.manipulability_series[3].waypoint, 3);
        assert!(
            (back.manipulability_series[3].yoshikawa - (0.1 + 3.0 * 0.01)).abs() < 1e-12,
            "round-trip must preserve yoshikawa"
        );
    }

    #[test]
    fn manipulability_series_empty_for_trivial_plan() {
        // Spec "Series empty for trivial plan": 0 waypoints → the field is
        // omitted on the wire (skip_serializing_if, additive for old clients)
        // and deserializes back to an empty array (serde default).
        let report = sample_report();
        let analysis = sample_analysis(0);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[]);

        let value = serde_json::to_value(response).expect("serialize");
        assert!(
            value.get("manipulability_series").is_none(),
            "empty series must be skipped on the wire (additive for old clients)"
        );

        let json = serde_json::to_string(&value).expect("serialize");
        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(
            back.manipulability_series,
            Vec::new(),
            "absent field must default to an empty array"
        );
    }

    #[test]
    fn old_payload_without_new_fields_deserializes() {
        // Spec I3 "Old client unaffected" + "Serde default for new fields":
        // a payload without `manipulability_series` deserializes fine — the
        // field defaults to empty; every pre-existing field keeps its shape.
        let report = sample_report();
        let analysis = sample_analysis(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[]);

        let mut value = serde_json::to_value(response).expect("serialize");
        value
            .as_object_mut()
            .expect("object")
            .remove("manipulability_series");

        let back: PlanAnalysisResponse =
            serde_json::from_value(value).expect("old payload must deserialize");
        assert!(back.manipulability_series.is_empty());
        assert_eq!(
            back.summary.score, 40,
            "pre-existing fields keep their shape"
        );
        assert_eq!(back.observations.len(), 2);
    }

    // ─── PR2: recommendations[] additive wire field (spec recommendation-model
    // "Wire Contract") ──────────────────────────────────────────────────────

    use thalos_core::analysis::action::{
        Action, ActionId, ActionImpact, ActionKind, ActionPriority,
    };
    use thalos_core::analysis::observation::ObservationId;
    use thalos_core::motion::segment::MotionSegment;
    use thalos_planning::program_edit::ProgramEdit;
    use thalos_planning::recommendation::{Recommendation, RecommendationId};

    fn sample_recommendation() -> Recommendation {
        let mut parameters = BTreeMap::new();
        parameters.insert("value".to_string(), AttributeValue::Number(0.12));
        Recommendation {
            id: RecommendationId(7),
            action: Action {
                id: ActionId(1),
                kind: ActionKind::Manipulability,
                target_observation: ObservationId(2),
                priority: ActionPriority::High,
                impact: ActionImpact::High,
                parameters,
            },
            edit: ProgramEdit::ReplaceSegment {
                index: 0,
                replacement: vec![MotionSegment::MoveJ {
                    origin: OperationId("op-j".to_string()),
                    target: vec![0.5, 1.0],
                    max_velocity: Some(500.0),
                    max_acceleration: None,
                }],
                original: Some(MotionSegment::MoveJ {
                    origin: OperationId("op-l".to_string()),
                    target: vec![0.0, 0.0],
                    max_velocity: Some(500.0),
                    max_acceleration: None,
                }),
            },
            status: Some(RecommendationStatus::Available),
        }
    }

    #[test]
    fn old_json_without_recommendations_deserializes_to_empty() {
        // Spec recommendation-model "Old client deserialization": a response
        // JSON without `recommendations` deserializes with the field defaulting
        // to an empty vec (`#[serde(default)]`).
        let report = sample_report();
        let analysis = sample_analysis(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[]);

        let mut value = serde_json::to_value(response).expect("serialize");
        value
            .as_object_mut()
            .expect("object")
            .remove("recommendations");

        let back: PlanAnalysisResponse = serde_json::from_value(value)
            .expect("old JSON without recommendations must deserialize");
        assert!(
            back.recommendations.is_empty(),
            "absent recommendations field must default to an empty vec"
        );
    }

    #[test]
    fn recommendations_populated_with_id_action_edit() {
        // Spec recommendation-model "New client deserialization": with the
        // field present, recommendations carry id, action and edit.
        let report = sample_report();
        let analysis = sample_analysis(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let rec = sample_recommendation();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[rec]);

        let value = serde_json::to_value(&response).expect("serialize");
        let arr = value["recommendations"].as_array().expect("array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], 7);
        assert_eq!(arr[0]["action"]["kind"], "Manipulability");
        assert_eq!(arr[0]["action"]["target_observation"], 2);
        assert!(
            arr[0]["edit"]["ReplaceSegment"].is_object(),
            "typed edit on the wire"
        );
        assert_eq!(arr[0]["status"], "available");

        let json = serde_json::to_string(&response).expect("serialize");
        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.recommendations.len(), 1);
        assert_eq!(back.recommendations[0].id, 7);
        assert!(matches!(
            back.recommendations[0].edit,
            ProgramEdit::ReplaceSegment { .. }
        ));
    }

    #[test]
    fn empty_recommendations_are_omitted_on_the_wire() {
        // Additive contract: an empty recommendations[] is skipped, so old
        // clients never see a breaking shape change.
        let report = sample_report();
        let analysis = sample_analysis(0);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[]);

        let value = serde_json::to_value(response).expect("serialize");
        assert!(
            value.get("recommendations").is_none(),
            "empty recommendations must be skipped on the wire (additive)"
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
