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
//!   "manipulability_series": [ { "waypoint": 0, "yoshikawa": 0.42, "det_jtj": 0.18 }, ... ]  // S1 (P3), opcional
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
        singularity::{SingularityAnalysis, SingularityConfig, SingularityState},
        summary::AnalysisSummary,
    },
    ids::{ExecutionSessionId, MotionPlanId, RobotId, SceneId, SemanticProgramId, TaskDocumentId},
    operation::MotionProvenance,
};
use thalos_planning::analysis::PlanAnalysis;
use thalos_planning::candidate::{
    CandidateRanking, NoCandidateReason, SelectionReason, StrategyKind, StrategyOutcome,
    StrategyTrace,
};
use thalos_planning::motion::program::PlannedSegment;
use thalos_planning::program_edit::ProgramEdit;
use thalos_planning::recommendation::{Recommendation, RecommendationStatus, UnavailabilityReason};

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

/// Request para editar el programa activo con un `ProgramEdit` LIBRE (CDD
/// step 3).
///
/// `POST /plan/program/edit` — la contraparte de `ApplyRequest` que NO pasa
/// por un `recommendation_id` del advisor: el cliente construye el comando
/// semántico directamente (D1) y el backend lo aplica con el MISMO ciclo que
/// `apply_command` (`edit.apply(program)` → recompile → re-analyze →
/// write-back). `ProgramEdit` sigue siendo la API semántica — no hay un
/// formato HTTP paralelo (spec program-edit).
#[derive(Debug, Deserialize)]
pub struct EditProgramRequest {
    /// Comando semántico de plan (serde externally-tagged, D1). El frontend lo
    /// construye desde la edición de un segmento del `ProgramView`.
    pub edit: ProgramEdit,
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

/// Respuesta de deshacer el último comando aplicado (PR5).
///
/// Undo O(1) (design D6): pop del último `AppliedCommand` + `apply(inverse)`
/// — nunca replay del historial. La salud restaurada se reporta desde las
/// métricas almacenadas en el entry (sin re-ejecutar el pipeline de análisis).
#[derive(Debug, Serialize)]
pub struct UndoResponse {
    /// Id del plan restaurado (el write-back asignó un nuevo id).
    pub plan_id: String,
    /// Salud (0..1) del plan que se está deshaciendo — la que el comando
    /// deshecho había activado (equivale al `health_after` de su apply).
    pub health_before: f64,
    /// Salud (0..1) del plan restaurado — el estado previo al comando
    /// (equivale al `health_before` de su apply).
    pub health_after: f64,
    /// Diferencia de salud: `health_after - health_before` (negativo si el
    /// comando deshecho había mejorado el plan).
    pub improvement: f64,
    /// Tamaño del historial de comandos aplicados tras el pop.
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
    /// Serie de singularidad por waypoint (spec analysis-report-contract
    /// "Dense Singularity Series"): un punto
    /// `{waypoint, timestamp, det_jtj, condition_number, singularity_state}`
    /// por waypoint con reporte de singularidad — clasificación
    /// `"normal"|"near"|"singular"` EXACTAMENTE la del runtime
    /// (`SingularityAnalysis::classify_report`, misma lógica que emite las
    /// observaciones, ver singularity/report.rs). La serie es DENSE: cubre
    /// toda la trayectoria (a diferencia de `observations`, que solo emite
    /// anomalías) y permite al viewport colorear el plan completo. ADITIVO —
    /// `#[serde(default)]` + omitido cuando vacío: los clientes antiguos
    /// deserializan a `[]` sin error (I3).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub singularity_series: Vec<SingularityPointDto>,
    /// Recomendaciones de remediación (spec recommendation-model "Wire
    /// Contract"): cada una lleva `action` + `edit` (comando semántico de
    /// plan). ADITIVO — `#[serde(default)]` + omitido cuando vacío: los
    /// clientes antiguos (JSON sin el campo) deserializan a `[]`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recommendations: Vec<RecommendationDto>,
    /// Verdicto de inteligencia (thalos-intelligence) — proyección del
    /// `Assessment` del runtime. ADITIVO: `#[serde(default)]` + omitido cuando
    /// ausente (mismo patrón que `recommendations`); los clientes antiguos
    /// deserializan a `None` sin error (spec analysis-report-contract "Old
    /// Backend Omits Assessment").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assessment: Option<AssessmentDto>,
    /// Ranking de candidatos alternativos (PR3) — proyección del
    /// `CandidateRanking` del runtime (composición completa
    /// generate → compile → analyze → assess → gate → rank). ADITIVO:
    /// `#[serde(default)]` + omitido cuando ausente — los clientes antiguos
    /// (JSON sin el campo) deserializan a `None` sin error (back-compat wire,
    /// task 5.1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_ranking: Option<CandidateRankingDto>,
    /// Stable identity of the analyzed robot (spec `robot-identity`): the
    /// scene-owned identity (`metadata.id` for catalog robots, `urdf:<hash>`
    /// for URDF imports), stamped by the handler from the runtime snapshot —
    /// never derived from the chain. ADITIVE: `#[serde(default)]` + omitted
    /// when absent — old backends without the field keep working, and the
    /// frontend ignores it (contract note only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robot_id: Option<String>,
    /// Trayectoria baseline del plan activo — waypoints joint-space + timestamps.
    /// ADITIVO: `#[serde(default)]` + omitido cuando `None`: clientes antiguos
    /// deserializan a `None` sin error. Consumido por el evidence export para
    /// la cadena causal baseline → intelligence → selected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trajectory: Option<TrajectoryDto>,
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
        assessment: Option<&thalos_intelligence::Assessment>,
    ) -> Self {
        let regions = RegionGrouper::default().group(&report.observations);
        let manipulability_series = analysis
            .waypoints
            .iter()
            .filter_map(|w| {
                w.manipulability.as_ref().map(|m| ManipulabilityPointDto {
                    waypoint: w.index as u32,
                    // Tiempo del waypoint en segundos dentro de la trayectoria
                    // del plan (WaypointAnalysis.timestamp) — el eje temporal
                    // honesto para el gráfico (hotfix: la densidad de muestreo
                    // difiere entre segmentos, el índice de waypoint distorsiona).
                    timestamp: w.timestamp,
                    yoshikawa: m.yoshikawa,
                    // Proyección del det(J·Jᵀ) ya computado por el runtime en el
                    // SingularityReport del mismo waypoint (singularity.rs:51).
                    // Fallback yoshikawa² (matemáticamente idéntico: det(J·Jᵀ) =
                    // ∏σᵢ² = (∏σᵢ)²) solo si el reporte de singularidad faltara.
                    det_jtj: w
                        .singularity
                        .as_ref()
                        .map(|s| s.det_jtj)
                        .unwrap_or_else(|| m.yoshikawa * m.yoshikawa),
                    // Proyección aditiva del normalized + grade ya computados
                    // por el runtime (spec analysis-report-contract): el DTO
                    // nunca recalcula — solo proyecta al wire.
                    // `manipulability_grade` es la señal de presencia (design):
                    // el normalized SOLO se emite cuando hay grade (path
                    // normalizado); un path raw (`compute()`, S1 — planning)
                    // deja el campo en None → omitido del wire, el frontend
                    // cae a su fallback.
                    normalized_yoshikawa: m
                        .manipulability_grade
                        .map(|_| m.normalized_yoshikawa),
                    manipulability_grade: m.manipulability_grade.map(|g| g.as_str().to_string()),
                })
            })
            .collect();
        let singularity_series = analysis
            .waypoints
            .iter()
            .filter_map(|w| {
                w.singularity.as_ref().map(|s| SingularityPointDto {
                    waypoint: w.index as u32,
                    timestamp: w.timestamp,
                    det_jtj: s.det_jtj,
                    condition_number: s.condition_number,
                    // Clasificación del runtime, proyectada al wire: usa la
                    // MISMA lógica que emite las observaciones (threshold
                    // default) para que el color del viewport coincida con el
                    // diagnóstico del Assessor.
                    singularity_state: state_as_str(SingularityAnalysis::classify_report(
                        s,
                        &SingularityConfig::default(),
                    ))
                    .to_string(),
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
            singularity_series,
            recommendations: recommendations
                .iter()
                .map(RecommendationDto::from)
                .collect(),
            assessment: assessment.map(AssessmentDto::from),
            candidate_ranking: None,
            robot_id: report.robot_id.clone(),
            trajectory: None,
        }
    }

    /// ADITIVO (PR3): proyecta el `CandidateRanking` del runtime al wire.
    /// Separado de `from_report` para no tocar los call-sites existentes —
    /// el flujo con contexto de plan (programa + solver) lo invoca después.
    pub fn with_candidate_ranking(mut self, ranking: Option<&CandidateRanking>) -> Self {
        self.candidate_ranking = ranking.map(CandidateRankingDto::from);
        self
    }

    /// ADITIVO: proyecta la trayectoria baseline del plan activo al wire.
    /// Consumido por el evidence export para la cadena causal
    /// baseline → intelligence → selected.
    pub fn with_trajectory(mut self, trajectory: &thalos_core::trajectory::Trajectory) -> Self {
        self.trajectory = Some(TrajectoryDto::from_trajectory(trajectory));
        self
    }
}

/// Punto de la serie de manipulabilidad por waypoint (P3).
///
/// `waypoint` es el índice 0-based del waypoint en el plan; `yoshikawa` es la
/// medida de manipulabilidad del análisis técnico y `det_jtj` es el
/// determinante de `J·Jᵀ` (ambos proyecciones del mismo SVD — nunca
/// recomputados por el DTO). `det_jtj` es ADITIVO (`#[serde(default)]`): un
/// backend viejo sin el campo no rompe a los clientes (I3).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct ManipulabilityPointDto {
    /// Índice del waypoint en el plan (0-based).
    pub waypoint: u32,
    /// Tiempo del waypoint en segundos dentro de la trayectoria (eje X temporal
    /// del gráfico). ADITIVO (`#[serde(default)]`): un backend viejo sin el
    /// campo no rompe a los clientes (I3) — los builders caen al índice.
    #[serde(default)]
    pub timestamp: f64,
    /// Medida de manipulabilidad de Yoshikawa en ese waypoint.
    pub yoshikawa: f64,
    /// Determinante de J·Jᵀ (producto de los valores singulares al cuadrado).
    #[serde(default)]
    pub det_jtj: f64,
    /// Medida dimensionless `∏σ′ᵢ` del SVD del Jacobiano escalado (spec
    /// analysis-report-contract "Additive Normalized Manipulability on
    /// Wire"). ADITIVO + OMITIDO cuando `None`: un payload raw (sin grade)
    /// no serializa el campo — `manipulability_grade` es la señal de
    /// presencia y el frontend cae al fallback local. `0.0` es un valor
    /// normalizado VÁLIDO (singularidad), por eso el wire nunca debe
    /// fabricarlo como placeholder de un path raw.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_yoshikawa: Option<f64>,
    /// Grade clasificado por el backend (`"low" | "medium" | "high"`).
    /// `None` = payload legacy → el frontend aplica su fallback. El
    /// exponente `n_sv` NUNCA viaja en el contrato (decisión de diseño).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manipulability_grade: Option<String>,
}

/// Punto de la serie de singularidad por waypoint (dense).
///
/// Proyecta UN WAYPOINT del `analysis.waypoints` al wire (a diferencia de
/// `observations`, que solo emite anomalías). `singularity_state` es la
/// clasificación del runtime (`"normal" | "near" | "singular"`) re-derivada
/// con la MISMA lógica de `SingularityAnalysis::classify_report` (ver
/// singularity/report.rs) — jamás recomputada, se proyecta el estado al wire.
/// Los waypoints sin reporte de singularidad se omiten (filter_map), espejando
/// cómo `manipulability_series` trata los waypoints sin manipulabilidad.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SingularityPointDto {
    /// Índice del waypoint en el plan (0-based).
    pub waypoint: u32,
    /// Tiempo del waypoint en segundos dentro de la trayectoria (eje X temporal
    /// del gráfico). ADITIVO (`#[serde(default)]`): un backend viejo sin el
    /// campo no rompe a los clientes (I3) — los builders caen al índice.
    #[serde(default)]
    pub timestamp: f64,
    /// Determinante de J·Jᵀ (producto de los valores singulares al cuadrado),
    /// proyectado del `SingularityReport` del runtime.
    #[serde(default)]
    pub det_jtj: f64,
    /// Número de condición κ(J) en ese waypoint (del `SingularityReport`).
    #[serde(default)]
    pub condition_number: f64,
    /// Clasificación del runtime: `"normal" | "near" | "singular"`.
    pub singularity_state: String,
}

/// Convierte el [`SingularityState`] del runtime a su forma wire
/// `"normal" | "near" | "singular"` (contrato estable del viewport).
fn state_as_str(state: SingularityState) -> &'static str {
    match state {
        SingularityState::Normal => "normal",
        SingularityState::NearSingular => "near",
        SingularityState::Singular => "singular",
    }
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
/// conocen. `reason` (ADR-2, T10 M2) es ADITIVO: solo viaja cuando la
/// recomendación es `unavailable` y el motivo está poblado; los clientes
/// antiguos sin el campo deserializan a `None`.
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
    /// Motivo estructurado de la no-disponibilidad (design ADR-2). ADITIVO:
    /// omitido cuando `None` — los clientes antiguos deserializan sin cambio.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<UnavailabilityReason>,
}

impl From<&Recommendation> for RecommendationDto {
    fn from(r: &Recommendation) -> Self {
        Self {
            id: r.id.0,
            action: ActionDto::from(&r.action),
            edit: r.edit.clone(),
            status: r.status,
            reason: r.reason,
        }
    }
}

// ─── candidate_ranking (additive, PR3) ────────────────────────────────────
//
// The `candidate_ranking` wire field is a projection of the runtime
// `CandidateRanking` (thalos-planning candidate module). Additive:
// `#[serde(default)]` on `PlanAnalysisResponse.candidate_ranking` keeps old
// clients deserializing to `None` (task 5.1 wire back-compat). The strategy
// kind travels as a string (`"Direct" | "InsertWaypoint" | "AlternateElbow"`)
// and the reason keeps its STRUCTURAL shape — component ids + numeric values,
// never narrative text (spec "SelectionReason — Derived from Metric
// Differences").

/// Proyección del ranking de candidatos al wire: filas rankeadas, selección,
/// razón derivada y el strategy trace completo (ADR-3 observability).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct CandidateRankingDto {
    /// Los candidatos admisibles ordenados por costo J ascendente.
    pub ranked: Vec<RankedCandidateDto>,
    /// Estrategia del candidato seleccionado (argmin J), ausente cuando no
    /// hubo candidato admisible.
    pub selected: Option<String>,
    /// Razón derivada de la selección (estructura, no narrativa).
    pub reason: SelectionReasonDto,
    /// El strategy trace completo: cada estrategia aplicada con su resultado
    /// (`generated`/`skipped` + razón). ADITIVO — `#[serde(default)]`: un
    /// backend anterior sin este campo deserializa con trace vacío.
    #[serde(default)]
    pub strategy_trace: Vec<StrategyTraceDto>,
}

/// Una fila del ranking: estrategia + métricas raw + costo objetivo J.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct RankedCandidateDto {
    /// `"Direct" | "InsertWaypoint" | "AlternateElbow"`.
    pub strategy: String,
    /// RAW risk — el crisp `1 − quality` del Assessor (verbatim).
    pub risk: f64,
    /// RAW duration (s) — verbatim del trajectory analizado.
    pub duration: f64,
    /// RAW average manipulability — verbatim.
    pub manipulability: f64,
    /// RAW path length (m) — verbatim.
    pub length: f64,
    /// El costo objetivo `J = Σ w_i · norm_i` (RELATIVO al set de candidatos).
    pub cost: f64,
}

/// La razón de selección — DERIVADA de diferencias métricas vs el baseline
/// Direct; nunca texto manuscrito ni LLM.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SelectionReasonDto {
    /// `"selected"` | `"no_admissible_candidate"`.
    pub kind: String,
    /// La estrategia seleccionada (solo cuando `kind == "selected"`).
    pub strategy: Option<String>,
    /// Diferencias estructurales vs el baseline `Direct` (componentes fijos:
    /// risk, duration, manipulability, length, cost).
    pub metric_comparison: Vec<MetricComparisonDto>,
    /// Fijas: `"Endpoints: preserved"` — todo candidato admisible pasó la
    /// invariante de endpoints ε del gate (fase 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoints: Option<String>,
    /// Fija: `"Task: preserved"` — todo candidato admisible pasó la
    /// invariante de identidad de tarea del gate (fase 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    /// Razón estructural de no-selección (solo cuando
    /// `kind == "no_admissible_candidate"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Una fila de la comparación métrica: componente fijo + valores seleccionado
/// vs baseline. La dirección (`<` / `>`) es derivable de los valores.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct MetricComparisonDto {
    /// `"risk" | "duration" | "manipulability" | "length" | "cost"`.
    pub component: String,
    /// Valor del candidato seleccionado.
    pub selected_value: f64,
    /// Valor del baseline `Direct`.
    pub baseline_value: f64,
}

/// Una fila del strategy trace: la estrategia aplicada + su resultado.
/// El trace del generador es COMPLETO — incluye las estrategias que no
/// produjeron candidato, con su razón estructural (design ADR-3).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct StrategyTraceDto {
    /// `"Direct" | "InsertWaypoint" | "AlternateElbow"`.
    pub strategy: String,
    /// Resultado de la estrategia: `generated` o `skipped` (con razón).
    pub outcome: StrategyOutcomeDto,
}

/// Resultado de una estrategia en el trace — `generated` o `skipped` con
/// razón estructural. Un UI puede renderizar `Direct → Generated`,
/// `InsertWaypoint → Skipped — UnsupportedSegment` sin inventar nada.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct StrategyOutcomeDto {
    /// `"generated" | "skipped"`.
    pub kind: String,
    /// Razón estructural del skip (solo cuando `kind == "skipped"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<NoCandidateReasonDto>,
}

/// Razón estructural de no-generación (design ADR-3): `IkFailed` |
/// `UnsupportedSegment` | `InvariantViolation { invariant }`.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum NoCandidateReasonDto {
    /// La IK no convergió al materializar la edición.
    IkFailed,
    /// El tipo de segmento objetivo no es transformable por la estrategia.
    UnsupportedSegment,
    /// Una invariante dura fue violada (e.g. segmento fuera de rango).
    InvariantViolation {
        /// La invariante violada, legible.
        invariant: String,
    },
}

impl From<&CandidateRanking> for CandidateRankingDto {
    fn from(ranking: &CandidateRanking) -> Self {
        let reason = match &ranking.reason {
            SelectionReason::Selected {
                strategy,
                metric_comparison,
                endpoints,
                task,
            } => SelectionReasonDto {
                kind: "selected".to_string(),
                strategy: Some(format!("{strategy:?}")),
                metric_comparison: metric_comparison
                    .iter()
                    .map(|m| MetricComparisonDto {
                        component: m.component.clone(),
                        selected_value: m.selected_value,
                        baseline_value: m.baseline_value,
                    })
                    .collect(),
                endpoints: Some((*endpoints).to_string()),
                task: Some((*task).to_string()),
                reason: None,
            },
            SelectionReason::NoAdmissibleCandidate { reason } => SelectionReasonDto {
                kind: "no_admissible_candidate".to_string(),
                strategy: None,
                metric_comparison: Vec::new(),
                endpoints: None,
                task: None,
                reason: Some((*reason).to_string()),
            },
        };
        Self {
            ranked: ranking
                .ranked
                .iter()
                .map(|(candidate, score)| RankedCandidateDto {
                    strategy: format!("{:?}", candidate.strategy),
                    risk: score.risk,
                    duration: score.duration,
                    manipulability: score.manipulability,
                    length: score.length,
                    cost: score.cost,
                })
                .collect(),
            selected: ranking
                .selected
                .as_ref()
                .map(|c| format!("{:?}", c.strategy)),
            reason,
            strategy_trace: ranking
                .strategy_trace
                .iter()
                .map(|row| StrategyTraceDto {
                    strategy: format!("{:?}", row.strategy),
                    outcome: match &row.outcome {
                        StrategyOutcome::Generated(_) => StrategyOutcomeDto {
                            kind: "generated".to_string(),
                            reason: None,
                        },
                        StrategyOutcome::Skipped(reason) => StrategyOutcomeDto {
                            kind: "skipped".to_string(),
                            reason: Some(match reason {
                                NoCandidateReason::IkFailed => NoCandidateReasonDto::IkFailed,
                                NoCandidateReason::UnsupportedSegment => {
                                    NoCandidateReasonDto::UnsupportedSegment
                                }
                                NoCandidateReason::InvariantViolation { invariant } => {
                                    NoCandidateReasonDto::InvariantViolation {
                                        invariant: invariant.clone(),
                                    }
                                }
                            }),
                        },
                    },
                })
                .collect(),
        }
    }
}

// ─── Intelligent assessment (additive, spec analysis-report-contract) ─────
//
// The `assessment` wire field is a projection of the runtime `Assessment`
// (thalos-intelligence). Additive: `#[serde(default)]` on
// `PlanAnalysisResponse.assessment` keeps old clients deserializing to `None`.

/// Verdicto de inteligencia proyectado al wire (spec analysis-report-contract
/// "Assessment DTO Structure"): risk + quality + triggered_rules + evidence +
/// recommendations + trace.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct AssessmentDto {
    /// Categorical verdict ("low" | "medium" | "high" | "critical").
    pub risk: String,
    /// Quality score in [0, 1] (normalized complement of the crisp risk).
    pub quality: f64,
    /// Rules that fired during inference.
    pub triggered_rules: Vec<TriggeredRuleDto>,
    /// Key-value evidence (derived inputs + rule evidence).
    pub evidence: BTreeMap<String, f64>,
    /// References to existing PlanAdvisor actions by kind.
    pub recommendations: Vec<AssessmentRecommendationDto>,
    /// Inference trace in firing order.
    pub trace: Vec<TraceEntryDto>,
}

/// A fired rule summary on the wire.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct TriggeredRuleDto {
    /// Rule id, e.g. `"R07_low_manipulability"`.
    pub id: String,
    /// Reasoning category ("collision" | "singularity" | "manipulability" |
    /// "trajectory").
    pub category: String,
    /// Agenda priority.
    pub priority: u8,
}

/// A recommendation reference — an existing PlanAdvisor `ActionKind` the
/// diagnosis associates with (region-aware when resolvable).
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct AssessmentRecommendationDto {
    /// The associated action kind (e.g. "Manipulability").
    pub action_kind: String,
    /// Problem region the recommendation addresses, when resolvable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<usize>,
    /// Human-readable rationale (English).
    pub rationale: String,
}

/// One trace entry — a fired rule in exact execution order.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct TraceEntryDto {
    /// Fired rule id.
    pub rule_id: String,
    /// Agenda priority.
    pub priority: u8,
    /// Antecedent → matched value.
    pub bindings: BTreeMap<String, String>,
    /// Derived facts produced by this firing.
    pub derived_output: BTreeMap<String, bool>,
}

impl From<&thalos_intelligence::Assessment> for AssessmentDto {
    fn from(assessment: &thalos_intelligence::Assessment) -> Self {
        Self {
            risk: format!("{:?}", assessment.risk).to_lowercase(),
            quality: assessment.quality,
            triggered_rules: assessment
                .triggered_rules
                .iter()
                .map(|rule| TriggeredRuleDto {
                    id: rule.id.clone(),
                    category: format!("{:?}", rule.category).to_lowercase(),
                    priority: rule.priority,
                })
                .collect(),
            evidence: assessment.evidence.clone(),
            recommendations: assessment
                .recommendations
                .iter()
                .map(|recommendation| AssessmentRecommendationDto {
                    action_kind: format!("{:?}", recommendation.action_kind),
                    region_id: recommendation.region_id,
                    rationale: recommendation.rationale.clone(),
                })
                .collect(),
            trace: assessment
                .trace
                .iter()
                .map(|entry| TraceEntryDto {
                    rule_id: entry.rule_id.clone(),
                    priority: entry.priority,
                    bindings: entry.bindings.clone(),
                    derived_output: entry.derived_output.clone(),
                })
                .collect(),
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

/// Trayectoria baseline proyectada al wire — joint-space waypoints + timestamps.
/// Consumida por el evidence export para la cadena causal
/// baseline → intelligence → selected. ADITIVO: `#[serde(default)]` en
/// `PlanAnalysisResponse.trajectory` mantiene back-compat con clientes
/// antiguos.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct TrajectoryDto {
    /// Posiciones de joints por waypoint: `waypoints[i] = [j0, j1, j2, j3]`.
    pub waypoints: Vec<Vec<f64>>,
    /// Timestamps en segundos por waypoint.
    pub timestamps: Vec<f64>,
}

impl TrajectoryDto {
    /// Proyecta una `Trajectory` del dominio al DTO wire.
    pub fn from_trajectory(trajectory: &thalos_core::trajectory::Trajectory) -> Self {
        let waypoints = trajectory
            .waypoints()
            .iter()
            .map(|wp| wp.joints().to_vec())
            .collect();
        let timestamps = trajectory
            .waypoints()
            .iter()
            .map(|wp| wp.timestamp())
            .collect();
        Self {
            waypoints,
            timestamps,
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
    use thalos_planning::candidate::{Candidate, MetricComparison};
    use thalos_planning::motion::program::{PlannedSegment, PlanningProgram};

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
            robot_id: None,
        }
    }

    #[test]
    fn analysis_response_projects_report_wire_shape() {
        // Spec "AnalysisReport wire format": the response SHALL contain
        // observations[]/actions[]/metrics[]/summary.
        let report = sample_report();
        let segments: Vec<PlannedSegment> = Vec::new();
        let response =
            PlanAnalysisResponse::from_report(&report, &sample_analysis(0), &segments, &[], None);
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
    fn robot_id_is_projected_on_the_wire_when_present() {
        // Spec robot-identity "Report from loaded scene": the report's
        // scene-owned `robot_id` projects to the wire response.
        let mut report = sample_report();
        report.robot_id = Some("icebot-scene-42".to_string());
        let segments: Vec<PlannedSegment> = Vec::new();
        let response =
            PlanAnalysisResponse::from_report(&report, &sample_analysis(0), &segments, &[], None);
        let value = serde_json::to_value(response).expect("serialize");
        assert_eq!(
            value["robot_id"], "icebot-scene-42",
            "the wire must carry the report's robot_id"
        );
    }

    #[test]
    fn robot_id_is_omitted_from_the_wire_when_absent() {
        // ADITIVE contract: a report without robot_id (e.g. legacy analysis
        // path) omits the field entirely — old clients never see a null.
        let report = sample_report(); // robot_id: None
        let segments: Vec<PlannedSegment> = Vec::new();
        let response =
            PlanAnalysisResponse::from_report(&report, &sample_analysis(0), &segments, &[], None);
        let value = serde_json::to_value(response).expect("serialize");
        assert!(
            !value.as_object().expect("object").contains_key("robot_id"),
            "robot_id must be omitted when absent (skip_serializing_if)"
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
    fn old_json_without_candidate_ranking_deserializes() {
        // PR3 wire back-compat (task 5.1): a response JSON WITHOUT the new
        // `candidate_ranking` field must deserialize to `None` — old clients
        // and old backends keep working (additive `#[serde(default)]`).
        let json = json!({
            "artifact": {"kind": "MotionPlan", "id": "mp-1"},
            "observations": [],
            "actions": [],
            "metrics": {},
            "summary": {
                "quality_index": 0.8,
                "score": 80,
                "grade": "Good",
                "observation_count": 0,
                "severity_distribution": {}
            }
        });

        let response: PlanAnalysisResponse = serde_json::from_value(json)
            .expect("old JSON must deserialize without candidate_ranking");
        assert!(
            response.candidate_ranking.is_none(),
            "absent candidate_ranking must deserialize to None"
        );
    }

    #[test]
    fn new_json_with_candidate_ranking_deserializes() {
        // The new field round-trips: a backend that EMITS candidate_ranking
        // is consumable by new clients (values preserved verbatim).
        let json = json!({
            "artifact": {"kind": "MotionPlan", "id": "mp-1"},
            "observations": [],
            "actions": [],
            "metrics": {},
            "summary": {
                "quality_index": 0.8,
                "score": 80,
                "grade": "Good",
                "observation_count": 0,
                "severity_distribution": {}
            },
            "candidate_ranking": {
                "ranked": [
                    {
                        "strategy": "AlternateElbow",
                        "risk": 0.1625,
                        "duration": 5.2556,
                        "manipulability": 0.6314,
                        "length": 2.1398,
                        "cost": 0.0
                    },
                    {
                        "strategy": "Direct",
                        "risk": 0.5571,
                        "duration": 7.8179,
                        "manipulability": 0.4585,
                        "length": 3.885,
                        "cost": 1.0
                    }
                ],
                "selected": "AlternateElbow",
                "reason": {
                    "kind": "selected",
                    "strategy": "AlternateElbow",
                    "metric_comparison": [
                        {"component": "risk", "selected_value": 0.1625, "baseline_value": 0.5571}
                    ],
                    "endpoints": "Endpoints: preserved",
                    "task": "Task: preserved",
                    "reason": null
                }
            }
        });

        let response: PlanAnalysisResponse =
            serde_json::from_value(json).expect("new JSON with candidate_ranking must deserialize");
        let ranking = response
            .candidate_ranking
            .expect("candidate_ranking must be Some");
        assert_eq!(ranking.ranked.len(), 2);
        assert_eq!(ranking.ranked[0].strategy, "AlternateElbow");
        assert!((ranking.ranked[0].risk - 0.1625).abs() < 1e-12);
        assert_eq!(ranking.selected.as_deref(), Some("AlternateElbow"));
        assert_eq!(ranking.reason.kind, "selected");
        assert_eq!(
            ranking.reason.endpoints.as_deref(),
            Some("Endpoints: preserved")
        );
        assert_eq!(ranking.reason.metric_comparison[0].component, "risk");
    }

    // ── REMEDIATION (verify Warning 1 FIX, ADR-3 observability) — the
    //    strategy trace travels in the wire, additive and back-compatible ───

    #[test]
    fn candidate_ranking_without_strategy_trace_deserializes_as_empty() {
        // Wire back-compat for the trace field: a backend that emits
        // `candidate_ranking` WITHOUT the new `strategy_trace` key must still
        // deserialize — the field defaults to the empty trace (additive).
        let json = json!({
            "artifact": {"kind": "MotionPlan", "id": "mp-1"},
            "observations": [],
            "actions": [],
            "metrics": {},
            "summary": {
                "quality_index": 0.8,
                "score": 80,
                "grade": "Good",
                "observation_count": 0,
                "severity_distribution": {}
            },
            "candidate_ranking": {
                "ranked": [],
                "selected": null,
                "reason": {
                    "kind": "no_admissible_candidate",
                    "strategy": null,
                    "metric_comparison": [],
                    "endpoints": null,
                    "task": null,
                    "reason": "no admissible candidates"
                }
            }
        });

        let response: PlanAnalysisResponse = serde_json::from_value(json)
            .expect("candidate_ranking without strategy_trace must deserialize");
        let ranking = response
            .candidate_ranking
            .expect("candidate_ranking must be Some");
        assert!(
            ranking.strategy_trace.is_empty(),
            "absent strategy_trace must default to the empty trace"
        );
    }

    #[test]
    fn candidate_ranking_from_projects_the_strategy_trace_and_round_trips() {
        // The From projection must carry the FULL trace (every strategy →
        // Generated/Skipped(reason)) so a future UI can render
        // `Direct → Generated`, `InsertWaypoint → Skipped — UnsupportedSegment`,
        // `AlternateElbow → Generated` without inventing anything, and the
        // serde shape must round-trip verbatim.
        let direct = Candidate {
            strategy: StrategyKind::Direct,
            program: PlanningProgram::new(vec![]),
        };
        let alternate = Candidate {
            strategy: StrategyKind::AlternateElbow,
            program: PlanningProgram::new(vec![]),
        };
        let ranking = CandidateRanking {
            ranked: vec![],
            selected: Some(alternate.clone()),
            reason: SelectionReason::Selected {
                strategy: StrategyKind::AlternateElbow,
                metric_comparison: vec![MetricComparison {
                    component: "risk".to_string(),
                    selected_value: 0.1625,
                    baseline_value: 0.5571,
                }],
                endpoints: "Endpoints: preserved",
                task: "Task: preserved",
            },
            strategy_trace: vec![
                StrategyTrace {
                    strategy: StrategyKind::Direct,
                    outcome: StrategyOutcome::Generated(direct),
                },
                StrategyTrace {
                    strategy: StrategyKind::InsertWaypoint,
                    outcome: StrategyOutcome::Skipped(NoCandidateReason::UnsupportedSegment),
                },
                StrategyTrace {
                    strategy: StrategyKind::AlternateElbow,
                    outcome: StrategyOutcome::Generated(alternate),
                },
            ],
        };

        let dto = CandidateRankingDto::from(&ranking);

        assert_eq!(dto.strategy_trace.len(), 3);
        assert_eq!(dto.strategy_trace[0].strategy, "Direct");
        assert_eq!(dto.strategy_trace[0].outcome.kind, "generated");
        assert!(dto.strategy_trace[0].outcome.reason.is_none());
        assert_eq!(dto.strategy_trace[1].strategy, "InsertWaypoint");
        assert_eq!(dto.strategy_trace[1].outcome.kind, "skipped");
        assert_eq!(
            dto.strategy_trace[1].outcome.reason,
            Some(NoCandidateReasonDto::UnsupportedSegment)
        );
        assert_eq!(dto.strategy_trace[2].strategy, "AlternateElbow");
        assert_eq!(dto.strategy_trace[2].outcome.kind, "generated");

        // Serde round-trip: the wire shape preserves the trace verbatim.
        let json = serde_json::to_value(&dto).expect("the DTO must serialize");
        let back: CandidateRankingDto =
            serde_json::from_value(json).expect("the wire shape must deserialize");
        assert_eq!(back, dto, "strategy_trace must round-trip verbatim");
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
    use thalos_core::kinematics::jacobian::singularity::SingularityReport;
    use thalos_planning::analysis::{AnalysisMetrics, WaypointAnalysis};

    /// `PlanAnalysis` con `count` waypoints, cada uno con manipulabilidad
    /// determinística `yoshikawa = 0.1 + i * 0.01` (i = índice del waypoint) y
    /// su singularidad consistente (`det_jtj = yoshikawa²`, mismo SVD).
    fn sample_analysis(count: usize) -> PlanAnalysis {
        PlanAnalysis {
            waypoints: (0..count)
                .map(|i| {
                    let yoshikawa = 0.1 + i as f64 * 0.01;
                    WaypointAnalysis {
                        index: i,
                        timestamp: i as f64 * 0.5,
                        joints: vec![0.0, 0.0],
                        singularity: Some(SingularityReport {
                            det_jtj: yoshikawa * yoshikawa,
                            condition_number: 1.0,
                            rank: 2,
                            singular_values: vec![yoshikawa.sqrt(), yoshikawa.sqrt()],
                        }),
                        manipulability: Some(ManipulabilityReport {
                            yoshikawa,
                            isotropy: 1.0,
                            ..Default::default()
                        }),
                        min_collision_distance: None,
                    }
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
            None,
        ))
        .expect("serialize");
        let series = value["manipulability_series"]
            .as_array()
            .expect("manipulability_series must be an array");
        assert_eq!(series.len(), 20, "20 waypoints → 20 series entries");
        assert_eq!(series[0]["waypoint"], 0);
        assert!((series[0]["yoshikawa"].as_f64().expect("f64") - 0.1).abs() < 1e-12);
        assert_eq!(
            series[0]["timestamp"].as_f64().expect("f64"),
            0.0,
            "each point must carry its trajectory time in seconds"
        );
        assert!(
            (series[0]["det_jtj"].as_f64().expect("f64") - 0.1 * 0.1).abs() < 1e-12,
            "each point must carry the Jacobian determinant (det(J·Jᵀ))"
        );
        assert_eq!(series[19]["waypoint"], 19);
        assert!(
            (series[19]["yoshikawa"].as_f64().expect("f64") - (0.1 + 19.0 * 0.01)).abs() < 1e-12
        );
        assert_eq!(
            series[19]["timestamp"].as_f64().expect("f64"),
            19.0 * 0.5,
            "the last point carries the end-of-trajectory timestamp"
        );
        assert!(
            (series[19]["det_jtj"].as_f64().expect("f64") - (0.29 * 0.29)).abs() < 1e-12,
            "det_jtj = (yoshikawa)² when both derive from the same SVD"
        );
    }

    #[test]
    fn manipulability_series_round_trips_preserving_values() {
        // Serde round-trip: 20 entries survive serialize → deserialize with
        // exact waypoint/yoshikawa values (contract fidelity for the chart).
        let report = sample_report();
        let analysis = sample_analysis(20);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let json = serde_json::to_string(&response).expect("serialize");
        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.manipulability_series.len(), 20);
        assert_eq!(back.manipulability_series[3].waypoint, 3);
        assert!(
            (back.manipulability_series[3].yoshikawa - (0.1 + 3.0 * 0.01)).abs() < 1e-12,
            "round-trip must preserve yoshikawa"
        );
        assert!(
            (back.manipulability_series[3].det_jtj - (0.13 * 0.13)).abs() < 1e-12,
            "round-trip must preserve det_jtj"
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
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

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
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

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

    #[test]
    fn old_series_point_without_det_jtj_deserializes() {
        // Additive field (I3): a series point from an older backend that lacks
        // `det_jtj` must deserialize — the field defaults instead of failing.
        let report = sample_report();
        let analysis = sample_analysis(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let mut value = serde_json::to_value(response).expect("serialize");
        value["manipulability_series"][0]
            .as_object_mut()
            .expect("series point")
            .remove("det_jtj");

        let back: PlanAnalysisResponse =
            serde_json::from_value(value).expect("old series point must deserialize");
        assert_eq!(
            back.manipulability_series[0].det_jtj, 0.0,
            "missing det_jtj must default to 0.0 (serde default)"
        );
        assert!(
            (back.manipulability_series[0].yoshikawa - 0.1).abs() < 1e-12,
            "pre-existing series fields keep their values"
        );
    }

    #[test]
    fn old_series_point_without_timestamp_deserializes() {
        // Additive field (I3): a series point from an older backend that lacks
        // `timestamp` must deserialize — the field defaults (0.0) instead of
        // failing, so the chart can fall back to the waypoint index.
        let report = sample_report();
        let analysis = sample_analysis(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let mut value = serde_json::to_value(response).expect("serialize");
        value["manipulability_series"][0]
            .as_object_mut()
            .expect("series point")
            .remove("timestamp");

        let back: PlanAnalysisResponse =
            serde_json::from_value(value).expect("old series point must deserialize");
        assert_eq!(
            back.manipulability_series[0].timestamp, 0.0,
            "missing timestamp must default to 0.0 (serde default)"
        );
        assert!(
            (back.manipulability_series[0].yoshikawa - 0.1).abs() < 1e-12,
            "pre-existing series fields keep their values"
        );
    }

    // ─── Task 3.2: additive normalized_yoshikawa + manipulability_grade ─────
    //
    // Spec analysis-report-contract "Additive Normalized Manipulability on
    // Wire": both fields are additive (#[serde(default)]); the raw yoshikawa
    // stays untouched; the exponent n_sv never appears on the wire.

    use thalos_core::kinematics::jacobian::manipulability::ManipulabilityGrade;

    /// Same shape as `sample_analysis` but each waypoint carries the
    /// normalized measure + backend-classified grade (new-backend payload).
    fn sample_analysis_normalized(count: usize) -> PlanAnalysis {
        let base = sample_analysis(count);
        PlanAnalysis {
            waypoints: base
                .waypoints
                .into_iter()
                .map(|mut w| {
                    let normalized = w.index as f64 * 0.05 + 0.15;
                    w.manipulability = w.manipulability.map(|mut m| {
                        m.normalized_yoshikawa = normalized;
                        m.manipulability_grade = Some(if normalized < 0.25 {
                            ManipulabilityGrade::Medium
                        } else {
                            ManipulabilityGrade::High
                        });
                        m
                    });
                    w
                })
                .collect(),
            ..base
        }
    }

    #[test]
    fn manipulability_series_projects_normalized_and_grade() {
        // Spec "New client receives normalized fields": the wire carries
        // normalized_yoshikawa + manipulability_grade per point.
        let report = sample_report();
        let analysis = sample_analysis_normalized(3);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let value = serde_json::to_value(response).expect("serialize");
        let series = value["manipulability_series"]
            .as_array()
            .expect("manipulability_series must be an array");
        assert_eq!(series.len(), 3);
        assert!(
            (series[1]["normalized_yoshikawa"].as_f64().expect("f64") - 0.2).abs() < 1e-12,
            "normalized_yoshikawa must be projected per point"
        );
        assert_eq!(
            series[1]["manipulability_grade"], "medium",
            "manipulability_grade must be the lowercase string on the wire"
        );
        assert!(
            (series[2]["normalized_yoshikawa"].as_f64().expect("f64") - 0.25).abs() < 1e-12
        );
        assert_eq!(series[2]["manipulability_grade"], "high");
        // Raw yoshikawa stays untouched on the wire.
        assert!((series[1]["yoshikawa"].as_f64().expect("f64") - 0.11).abs() < 1e-12);
        // The exponent n_sv is never exposed.
        for point in series.iter() {
            assert!(
                point.get("n_sv").is_none() && point.get("exponent").is_none(),
                "the exponent must not leak into the wire contract"
            );
        }
    }

    #[test]
    fn raw_payload_omits_normalized_yoshikawa_from_wire() {
        // Review blocker: the `/plan/analyze` path (S1) still computes raw
        // (`ManipulabilityReport::compute()` → grade None, normalized 0.0).
        // Serializing `normalized_yoshikawa: 0.0` made the frontend treat the
        // payload as normalized (presence signal) and plot flat zeros. The DTO
        // must OMIT the field for a grade-less (raw) payload — the chart then
        // runs its local fallback.
        let report = sample_report();
        let analysis = sample_analysis(3);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let value = serde_json::to_value(response).expect("serialize");
        let series = value["manipulability_series"]
            .as_array()
            .expect("manipulability_series must be an array");
        assert_eq!(series.len(), 3);
        for point in series.iter() {
            assert!(
                point.get("normalized_yoshikawa").is_none(),
                "a raw (grade-less) payload must omit normalized_yoshikawa — got {point}"
            );
            assert!(point.get("manipulability_grade").is_none());
            assert!(
                point["yoshikawa"].is_f64(),
                "the raw yoshikawa stays on the wire"
            );
        }
    }

    #[test]
    fn normalized_payload_serializes_normalized_yoshikawa() {
        // Contrast: a normalized payload (grade present) DOES carry
        // normalized_yoshikawa — the chart consumes it verbatim.
        let report = sample_report();
        let analysis = sample_analysis_normalized(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let value = serde_json::to_value(response).expect("serialize");
        let series = value["manipulability_series"]
            .as_array()
            .expect("manipulability_series must be an array");
        assert!(
            series[0]["normalized_yoshikawa"].is_f64(),
            "a normalized payload must serialize normalized_yoshikawa"
        );
        assert_eq!(series[0]["manipulability_grade"], "medium");
    }

    #[test]
    fn legacy_series_point_without_normalized_fields_deserializes() {
        // Spec "Legacy payload missing normalized fields": a payload without
        // normalized_yoshikawa / manipulability_grade deserializes with the
        // defaults (0.0 / None).
        let report = sample_report();
        let analysis = sample_analysis_normalized(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let mut value = serde_json::to_value(response).expect("serialize");
        for i in 0..2 {
            value["manipulability_series"][i]
                .as_object_mut()
                .expect("series point")
                .remove("normalized_yoshikawa");
            value["manipulability_series"][i]
                .as_object_mut()
                .expect("series point")
                .remove("manipulability_grade");
        }

        let back: PlanAnalysisResponse =
            serde_json::from_value(value).expect("legacy point must deserialize");
        assert_eq!(back.manipulability_series[0].normalized_yoshikawa, None);
        assert_eq!(back.manipulability_series[0].manipulability_grade, None);
assert!(
            (back.manipulability_series[0].yoshikawa - 0.1).abs() < 1e-12,
            "pre-existing series fields keep their values"
        );
    }

    // ─── Dense singularity_series (spec analysis-report-contract) ──────────
    //
    // A diferencia de `observations` (que solo emite anomalías), la serie de
    // singularidad es DENSE: cubre cada waypoint con reporte de singularidad y
    // permite al viewport colorear el plan completo. La clasificación
    // `singularity_state` es del runtime (`SingularityAnalysis::classify_report`).

    #[test]
    fn singularity_series_projects_one_entry_per_waypoint() {
        // A 20-waypoint plan with a singularity report at every waypoint →
        // 20 entries, each carrying waypoint, timestamp, det_jtj and the
        // runtime classification (condition 1.0/rank 2 → "normal").
        let report = sample_report();
        let analysis = sample_analysis(20);
        let segments: Vec<PlannedSegment> = Vec::new();

        let value = serde_json::to_value(PlanAnalysisResponse::from_report(
            &report,
            &analysis,
            &segments,
            &[],
            None,
        ))
        .expect("serialize");
        let series = value["singularity_series"]
            .as_array()
            .expect("singularity_series must be an array");
        assert_eq!(series.len(), 20, "20 waypoints → 20 series entries");
        assert_eq!(series[0]["waypoint"], 0);
        assert_eq!(series[0]["singularity_state"], "normal");
        assert_eq!(
            series[0]["timestamp"].as_f64().expect("f64"),
            0.0,
            "each point must carry its trajectory time in seconds"
        );
        assert!(
            (series[0]["det_jtj"].as_f64().expect("f64") - 0.01).abs() < 1e-12,
            "det_jtj = yoshikawa² (0.1²) must be projected"
        );
        assert_eq!(series[19]["waypoint"], 19);
        assert_eq!(
            series[19]["timestamp"].as_f64().expect("f64"),
            19.0 * 0.5,
            "the last point carries the end-of-trajectory timestamp"
        );
    }

    #[test]
    fn singularity_series_classifies_into_normal_near_singular() {
        // The wire state must EXACTLY match the runtime classification used by
        // the Assessor: healthy → "normal", condition > 100 → "near",
        // rank-deficient/infinite → "singular".
        fn wp(i: usize, condition: f64, rank: usize) -> WaypointAnalysis {
            WaypointAnalysis {
                index: i,
                timestamp: i as f64,
                joints: vec![0.0, 0.0],
                singularity: Some(SingularityReport {
                    det_jtj: 1.0,
                    condition_number: condition,
                    rank,
                    singular_values: vec![1.0, 1.0],
                }),
                manipulability: None,
                min_collision_distance: None,
            }
        }
        let analysis = PlanAnalysis {
            waypoints: vec![wp(0, 2.0, 2), wp(1, 150.0, 2), wp(2, f64::INFINITY, 1)],
            metrics: AnalysisMetrics {
                waypoint_count: 3,
                trajectory_duration: 0.0,
                avg_manipulability: None,
                min_manipulability: None,
                near_singular_count: 1,
                singular_count: 1,
                min_collision_distance: None,
                min_collision_waypoint: None,
                has_collisions: false,
                first_collision_waypoint: None,
            },
            constraint_violations: Vec::new(),
        };
        let report = sample_report();
        let segments: Vec<PlannedSegment> = Vec::new();
        let value = serde_json::to_value(PlanAnalysisResponse::from_report(
            &report,
            &analysis,
            &segments,
            &[],
            None,
        ))
        .expect("serialize");
        let series = value["singularity_series"]
            .as_array()
            .expect("singularity_series must be an array");
        assert_eq!(series.len(), 3);
        assert_eq!(series[0]["singularity_state"], "normal");
        assert_eq!(series[1]["singularity_state"], "near");
        assert_eq!(series[2]["singularity_state"], "singular");
    }

    #[test]
    fn singularity_series_round_trips_preserving_values() {
        // Serde round-trip: entries survive serialize → deserialize with exact
        // waypoint/det_jtj/state values.
        let report = sample_report();
        let analysis = sample_analysis(20);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let json = serde_json::to_string(&response).expect("serialize");
        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.singularity_series.len(), 20);
        assert_eq!(back.singularity_series[3].waypoint, 3);
        assert_eq!(back.singularity_series[3].singularity_state, "normal");
        assert!(
            (back.singularity_series[3].condition_number - 1.0).abs() < 1e-12,
            "round-trip must preserve condition_number"
        );
    }

    #[test]
    fn singularity_series_empty_for_trivial_plan() {
        // 0 waypoints → the field is omitted on the wire (skip_serializing_if,
        // additive for old clients) and deserializes back to an empty array.
        let report = sample_report();
        let analysis = sample_analysis(0);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let value = serde_json::to_value(response).expect("serialize");
        assert!(
            value.get("singularity_series").is_none(),
            "empty series must be skipped on the wire (additive for old clients)"
        );

        let json = serde_json::to_string(&value).expect("serialize");
        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(
            back.singularity_series,
            Vec::new(),
            "absent field must default to an empty array"
        );
    }

    #[test]
    fn singularity_series_skips_waypoints_without_report() {
        // filter_map: a waypoint without a singularity report is omitted from
        // the series (mirroring how manipulability_series drops None) rather
        // than fabricated.
        let report = sample_report();
        let mut analysis = sample_analysis(3);
        analysis.waypoints[1].singularity = None;
        let segments: Vec<PlannedSegment> = Vec::new();
        let value = serde_json::to_value(PlanAnalysisResponse::from_report(
            &report,
            &analysis,
            &segments,
            &[],
            None,
        ))
        .expect("serialize");
        let series = value["singularity_series"]
            .as_array()
            .expect("singularity_series must be an array");
        assert_eq!(series.len(), 2, "waypoint[1] without singularity is dropped");
        assert_eq!(series[0]["waypoint"], 0);
        assert_eq!(series[1]["waypoint"], 2);
    }

    #[test]
    fn old_payload_without_singularity_series_deserializes() {
        // Spec I3 "Old client unaffected": a payload without
        // `singularity_series` deserializes fine — the field defaults to empty.
        let report = sample_report();
        let analysis = sample_analysis(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

        let mut value = serde_json::to_value(response).expect("serialize");
        value
            .as_object_mut()
            .expect("object")
            .remove("singularity_series");

        let back: PlanAnalysisResponse =
            serde_json::from_value(value).expect("old payload must deserialize");
        assert!(back.singularity_series.is_empty());
        assert_eq!(back.summary.score, 40, "pre-existing fields keep their shape");
    }

    #[test]
    fn new_series_point_ignored_by_old_client() {
        // Spec "Old client backward compatibility": deserializing into a
        // client that does NOT know the new fields must succeed — serde
        // ignores unknown fields (no deny_unknown_fields here).
        let report = sample_report();
        let analysis = sample_analysis_normalized(2);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);
        let json = serde_json::to_string(&response).expect("serialize");

        // A minimal legacy-shaped DTO: only the pre-existing fields.
        #[derive(serde::Deserialize)]
        struct LegacyPoint {
            waypoint: u32,
            #[serde(default)]
            timestamp: f64,
            yoshikawa: f64,
            #[serde(default)]
            det_jtj: f64,
        }
        let value: serde_json::Value = serde_json::from_str(&json).expect("parse");
        let legacy: LegacyPoint =
            serde_json::from_value(value["manipulability_series"][0].clone())
                .expect("old client must ignore the new fields");
        assert_eq!(legacy.waypoint, 0);
        assert!((legacy.yoshikawa - 0.1).abs() < 1e-12);
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
                original: Some(vec![MotionSegment::MoveJ {
                    origin: OperationId("op-l".to_string()),
                    target: vec![0.0, 0.0],
                    max_velocity: Some(500.0),
                    max_acceleration: None,
                }]),
            },
            status: Some(RecommendationStatus::Available),
            reason: None,
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
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

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
        let response =
            PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[rec], None);

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

    // ── T10 (M2): additive `reason` projection (design ADR-2) ──────────────

    #[test]
    fn recommendation_dto_round_trips_reason_on_the_wire() {
        // Spec recommendation-availability-contract "Availability Reason
        // Exposure": an unavailable recommendation carries its structured
        // reason through the DTO, losslessly.
        use thalos_planning::recommendation::UnavailabilityReason;

        let mut rec = sample_recommendation();
        rec.status = Some(RecommendationStatus::Unavailable);
        rec.reason = Some(UnavailabilityReason::IkFailed);

        let dto = RecommendationDto::from(&rec);
        let value = serde_json::to_value(&dto).expect("serialize");
        assert_eq!(
            value["reason"], "ik_failed",
            "the reason must project snake_case on the wire"
        );

        let back: RecommendationDto =
            serde_json::from_value(value).expect("dto must round-trip");
        assert_eq!(back.reason, Some(UnavailabilityReason::IkFailed));
        assert_eq!(back.status, Some(RecommendationStatus::Unavailable));
    }

    #[test]
    fn recommendation_dto_without_reason_skips_it_and_deserializes() {
        // Additive contract (I3): an available/undetermined recommendation has
        // no reason — it is skipped on the wire, and old JSON without the
        // field deserializes to None.
        use thalos_planning::recommendation::UnavailabilityReason;

        let dto = RecommendationDto::from(&sample_recommendation());
        let value = serde_json::to_value(&dto).expect("serialize");
        assert!(
            value.get("reason").is_none(),
            "None reason must be skipped on the wire"
        );

        let mut legacy = value.clone();
        legacy
            .as_object_mut()
            .expect("object")
            .remove("reason");
        let back: RecommendationDto =
            serde_json::from_value(legacy).expect("old JSON without reason must deserialize");
        assert_eq!(back.reason, None);
        assert_eq!(back.id, 7, "pre-existing fields keep their values");
    }

    #[test]
    fn empty_recommendations_are_omitted_on_the_wire() {
        // Additive contract: an empty recommendations[] is skipped, so old
        // clients never see a breaking shape change.
        let report = sample_report();
        let analysis = sample_analysis(0);
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(&report, &analysis, &segments, &[], None);

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

    // ─── IA: additive `assessment` wire field (spec analysis-report-contract) ──

    fn sample_assessment() -> thalos_intelligence::Assessment {
        use thalos_intelligence::{Assessment, Risk, TraceEntry, TriggeredRule};
        Assessment {
            risk: Risk::High,
            quality: 0.3,
            triggered_rules: vec![TriggeredRule {
                id: "R07_low_manipulability".into(),
                category: thalos_intelligence::RuleCategory::Manipulability,
                priority: 3,
            }],
            evidence: BTreeMap::from([("manipulability".to_string(), 0.2)]),
            recommendations: vec![thalos_intelligence::RecommendationRef {
                action_kind: ActionKind::Manipulability,
                region_id: Some(3),
                rationale: "Improve manipulability near the flagged region.".to_string(),
            }],
            trace: vec![TraceEntry {
                rule_id: "R07_low_manipulability".into(),
                priority: 3,
                bindings: BTreeMap::from([("Manipulability IS low".to_string(), "0.67".into())]),
                derived_output: BTreeMap::from([("danger_zone".to_string(), true)]),
            }],
        }
    }

    #[test]
    fn assessment_dto_round_trips_preserving_trace_order() {
        // Spec analysis-report-contract "DTO Round-Trip Serialization": all
        // fields round-trip without loss and trace entries keep firing order.
        let dto = AssessmentDto::from(&sample_assessment());
        let json = serde_json::to_string(&dto).expect("serialize");
        let back: AssessmentDto = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, dto);
        let ids: Vec<&str> = back.trace.iter().map(|t| t.rule_id.as_str()).collect();
        assert_eq!(ids, vec!["R07_low_manipulability"]);
        assert_eq!(back.risk, "high");
        assert_eq!(back.triggered_rules[0].category, "manipulability");
        assert_eq!(back.recommendations[0].action_kind, "Manipulability");
        assert_eq!(back.recommendations[0].region_id, Some(3));
    }

    #[test]
    fn old_json_without_assessment_deserializes_to_none() {
        // Spec analysis-report-contract "Client Backward Compatibility": a
        // payload without `assessment` deserializes to None, never an error.
        let report = sample_report();
        let segments: Vec<PlannedSegment> = Vec::new();
        let response =
            PlanAnalysisResponse::from_report(&report, &sample_analysis(2), &segments, &[], None);
        let json = serde_json::to_string(&response).expect("serialize");
        let value: serde_json::Value = serde_json::from_str(&json).expect("parse");
        assert!(
            value.get("assessment").is_none(),
            "absent assessment must be omitted from the wire"
        );

        let back: PlanAnalysisResponse = serde_json::from_str(&json).expect("deserialize");
        assert!(
            back.assessment.is_none(),
            "absent assessment must deserialize to None"
        );
    }

    #[test]
    fn new_json_includes_assessment_field() {
        // Spec analysis-report-contract "New Backend Includes Assessment":
        // when the runtime produces an assessment, the wire carries it with all
        // six sections.
        let report = sample_report();
        let segments: Vec<PlannedSegment> = Vec::new();
        let response = PlanAnalysisResponse::from_report(
            &report,
            &sample_analysis(2),
            &segments,
            &[],
            Some(&sample_assessment()),
        );
        let value = serde_json::to_value(response).expect("serialize");
        let assessment = value
            .get("assessment")
            .expect("assessment must be present on the wire");
        for field in [
            "risk",
            "quality",
            "triggered_rules",
            "evidence",
            "recommendations",
            "trace",
        ] {
            assert!(
                assessment.get(field).is_some(),
                "assessment must carry `{field}`"
            );
        }
    }
}
