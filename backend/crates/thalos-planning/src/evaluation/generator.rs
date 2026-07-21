//! Generación de planes candidatos por perturbación determinista.
//!
//! Toma un plan existente + hallazgos del análisis, y produce variantes
//! modificando waypoints problemáticos. Cada variante se evalúa con el
//! `PlanEvaluator` para producir un ranking.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use thalos_core::trajectory::{Trajectory, TrajectoryPoint};

use crate::analysis::TrajectoryAnalyzer;
use crate::error::PlanningError;
use crate::evaluation::cost::{CostFunction, PlanScore};
use crate::evaluation::evaluator::PlanEvaluator;
use crate::evaluation::metrics::{MetricKind, PlanMetrics};
use crate::finding::{Finding, FindingKind, Severity};
use crate::motion::program::CompiledPlan;

/// Categoría de una región problemática — agrupa `FindingKind` en familias
/// de estrategias de búsqueda.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RegionCategory {
    /// Colisiones o proximidad a obstáculos.
    Collision,
    /// Problemas cinemáticos (singularidad, manipulabilidad baja).
    Kinematic,
    /// Desviaciones de tracking en ejecución.
    Tracking,
    /// Desviaciones de velocidad.
    Velocity,
    /// Violaciones de restricciones explícitas.
    Constraint,
}

impl RegionCategory {
    fn from_finding_kind(kind: FindingKind) -> Self {
        match kind {
            FindingKind::Collision | FindingKind::CollisionNear => RegionCategory::Collision,
            FindingKind::LowManipulability
            | FindingKind::NearSingularity
            | FindingKind::Singularity
            | FindingKind::IkSuggestion => RegionCategory::Kinematic,
            FindingKind::TrackingError
            | FindingKind::TrackingSpike
            | FindingKind::JointDeviation => RegionCategory::Tracking,
            FindingKind::VelocityDeviation => RegionCategory::Velocity,
            FindingKind::ConstraintViolation => RegionCategory::Constraint,
        }
    }
}

/// Una región problemática localizada — qué, dónde y por qué.
///
/// Cada `Finding` con waypoint conocido produce un `ProblemRegion`.
#[derive(Debug, Clone)]
pub struct ProblemRegion {
    /// Índice del waypoint problemático.
    pub waypoint: usize,
    /// Articulación específica (None = todas las articulaciones).
    pub joint: Option<usize>,
    /// Categoría para seleccionar estrategia de búsqueda.
    pub category: RegionCategory,
    /// Severidad del problema.
    pub severity: Severity,
}

/// Conjunto de regiones problemáticas — entrada estándar del generador.
///
/// Se construye desde `Vec<Finding>` y se consume en
/// [`AlternativeGenerator::generate_from_regions`].
#[derive(Debug, Clone)]
pub struct ProblemRegions {
    pub regions: Vec<ProblemRegion>,
}

impl ProblemRegions {
    /// Crear desde hallazgos del análisis.
    ///
    /// Cada `Finding` con `waypoint: Some(n)` produce un `ProblemRegion`.
    /// Si no tiene articulación específica, `joint` queda como `None`
    /// (el generador perturbará todas las articulaciones del waypoint).
    pub fn from_findings(findings: &[Finding]) -> Self {
        let mut regions: Vec<ProblemRegion> = findings
            .iter()
            .filter_map(|f| {
                let waypoint = f.waypoint?;
                Some(ProblemRegion {
                    waypoint,
                    joint: None, // el Finding actual no transporta joint
                    category: RegionCategory::from_finding_kind(f.kind),
                    severity: f.severity,
                })
            })
            .collect();
        // Orden estable por waypoint para que el generador itere secuencialmente.
        regions.sort_by_key(|r| r.waypoint);
        Self { regions }
    }

    /// Crear desde una lista explícita de waypoints (categoría genérica).
    pub fn from_indices(indices: Vec<usize>) -> Self {
        let mut indices = indices;
        indices.sort();
        indices.dedup();
        let regions: Vec<ProblemRegion> = indices
            .into_iter()
            .map(|waypoint| ProblemRegion {
                waypoint,
                joint: None,
                category: RegionCategory::Kinematic,
                severity: Severity::Warning,
            })
            .collect();
        Self { regions }
    }

    /// Crear región vacía (sin problemas).
    pub fn none() -> Self {
        Self { regions: vec![] }
    }

    pub fn is_empty(&self) -> bool {
        self.regions.is_empty()
    }

    /// Extraer índices de waypoint únicos (para compatibilidad con código
    /// que solo necesita saber qué waypoints están afectados).
    pub fn waypoint_indices(&self) -> Vec<usize> {
        let mut indices: Vec<usize> = self.regions.iter().map(|r| r.waypoint).collect();
        indices.sort();
        indices.dedup();
        indices
    }
}

/// Política de selección de waypoints a perturbar.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum SelectionPolicy {
    /// Solo perturbar waypoints que tengan hallazgos (recomendado para MVP).
    ProblematicWaypoints,
    /// Perturbar todos los waypoints (más costoso).
    AllWaypoints,
}

/// Estrategia de perturbación para generación de alternativas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerturbationStrategy {
    /// Magnitud de la perturbación articular en radianes.
    pub delta: f64,
    /// Máximo de candidatos a generar (0 = sin límite).
    pub max_candidates: usize,
    /// Política de selección de waypoints.
    pub selection_policy: SelectionPolicy,
    /// Pesos personalizados para la función de costo (opcional).
    /// Si es `None`, se usan los valores por defecto.
    pub cost_weights: Option<HashMap<MetricKind, f64>>,
}

impl PerturbationStrategy {
    /// Estrategia por defecto para el MVP.
    pub fn default_mvp() -> Self {
        Self {
            delta: 0.05,
            max_candidates: 10,
            selection_policy: SelectionPolicy::ProblematicWaypoints,
            cost_weights: None,
        }
    }
}

/// Una perturbación aplicada a un waypoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Perturbation {
    /// Índice del waypoint modificado.
    pub waypoint: usize,
    /// Índice de la articulación modificada.
    pub joint: usize,
    /// Delta aplicado (radianes).
    pub delta: f64,
}

/// Un plan candidato generado por perturbación.
#[derive(Debug, Clone)]
pub struct AlternativeCandidate {
    /// ID único dentro de esta generación.
    pub id: usize,
    /// Waypoint que se modificó para generar este candidato.
    pub source_waypoint: usize,
    /// Perturbaciones aplicadas.
    pub perturbations: Vec<Perturbation>,
    /// El plan resultante.
    pub plan: CompiledPlan,
}

/// Un candidato evaluado y rankeado.
#[derive(Debug, Clone)]
pub struct RankedAlternative {
    /// Posición en el ranking (1 = mejor).
    pub rank: usize,
    /// El candidato.
    pub candidate: AlternativeCandidate,
    /// Score del plan original (para comparación).
    pub original_score: PlanScore,
    /// Score de este candidato.
    pub score: PlanScore,
    /// Diferencias con el plan original (mejoras/empeoramientos).
    pub improvements: Vec<String>,
}

/// Genera planes candidatos alternativos a partir de un plan y sus hallazgos.
pub struct AlternativeGenerator;

impl AlternativeGenerator {
    // Mantener compatibilidad con la API existente que pasa findings.
    pub fn generate(
        plan: &CompiledPlan,
        findings: &[Finding],
        strategy: &PerturbationStrategy,
    ) -> Vec<AlternativeCandidate> {
        let regions = ProblemRegions::from_findings(findings);
        Self::generate_from_regions(plan, &regions, strategy)
    }

    /// Generar candidatos desde `ProblemRegions`.
    ///
    /// Para regiones `Kinematic` con waypoints consecutivos, perturba el mismo joint
    /// en TODOS los waypoints de la región simultáneamente (estrategia regional).
    /// Para el resto, perturba un waypoint a la vez (estrategia local).
    pub fn generate_from_regions(
        plan: &CompiledPlan,
        regions: &ProblemRegions,
        strategy: &PerturbationStrategy,
    ) -> Vec<AlternativeCandidate> {
        let waypoints = plan.merged_trajectory.waypoints();
        if waypoints.is_empty() {
            return vec![];
        }

        let dof = waypoints.first().map(|wp| wp.joints().len()).unwrap_or(0);

        let mut candidates: Vec<AlternativeCandidate> = Vec::new();
        let mut next_id = 0;

        match strategy.selection_policy {
            SelectionPolicy::AllWaypoints => {
                // Estrategia original: todos los waypoints, todos los joints
                if dof == 0 { return vec![]; }
                for wp_idx in 0..waypoints.len() {
                    for joint in 0..dof {
                        if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates { break; }
                        for &delta in &[strategy.delta, -strategy.delta] {
                            if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates { break; }
                            let modified = Self::apply_perturbation(plan, wp_idx, joint, delta);
                            candidates.push(Self::make_candidate(next_id, wp_idx, vec![Perturbation { waypoint: wp_idx, joint, delta }], modified));
                            next_id += 1;
                        }
                    }
                }
            }
            SelectionPolicy::ProblematicWaypoints => {
                // 1. Agrupar regiones Kinematic consecutivas
                let kinematic_groups = Self::group_kinematic_regions(&regions.regions);
                // 2. El resto como entries individuales
                let used: std::collections::HashSet<(usize, RegionCategory)> = kinematic_groups
                    .iter()
                    .flat_map(|(start, end, _cat)| (*start..=*end).map(|wp| (wp, RegionCategory::Kinematic)))
                    .collect();
                let singles: Vec<&ProblemRegion> = regions.regions.iter().filter(|r| !used.contains(&(r.waypoint, r.category))).collect();

                // Single-waypoint candidates (non-kinematic, isolated)
                for r in &singles {
                    let joints: Vec<usize> = if let Some(j) = r.joint { vec![j] } else { (0..dof).collect() };
                    for &joint in &joints {
                        if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates { break; }
                        for &delta in &[strategy.delta, -strategy.delta] {
                            if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates { break; }
                            let modified = Self::apply_perturbation(plan, r.waypoint, joint, delta);
                            candidates.push(Self::make_candidate(next_id, r.waypoint, vec![Perturbation { waypoint: r.waypoint, joint, delta }], modified));
                            next_id += 1;
                        }
                    }
                }

                // Regional candidates (consecutive Kinematic): perturbar mismo joint en todo el rango
                for &(start, end, _cat) in &kinematic_groups {
                    for joint in 0..dof {
                        if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates { break; }
                        for &delta in &[strategy.delta, -strategy.delta] {
                            if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates { break; }
                            let mut plan_copy = plan.clone();
                            let mut perturbations = Vec::new();
                            for wp in start..=end {
                                let modified_traj = Self::apply_perturbation_to_trajectory(&plan_copy.merged_trajectory, wp, joint, delta);
                                plan_copy.merged_trajectory = modified_traj;
                                perturbations.push(Perturbation { waypoint: wp, joint, delta });
                            }
                            candidates.push(Self::make_candidate(next_id, start, perturbations, plan_copy));
                            next_id += 1;
                        }
                    }
                }
            }
        }

        candidates
    }

    /// Agrupar regiones Kinematic consecutivas en rangos.
    fn group_kinematic_regions(regions: &[ProblemRegion]) -> Vec<(usize, usize, RegionCategory)> {
        let mut kinematic: Vec<usize> = regions.iter()
            .filter(|r| r.category == RegionCategory::Kinematic)
            .map(|r| r.waypoint)
            .collect();
        kinematic.sort();
        kinematic.dedup();
        if kinematic.is_empty() { return vec![]; }

        let mut groups = Vec::new();
        let mut start = kinematic[0];
        let mut end = kinematic[0];
        for &wp in &kinematic[1..] {
            if wp == end + 1 {
                end = wp;
            } else {
                if end > start { groups.push((start, end, RegionCategory::Kinematic)); }
                start = wp;
                end = wp;
            }
        }
        if end > start { groups.push((start, end, RegionCategory::Kinematic)); }
        groups
    }

    fn make_candidate(id: usize, source_wp: usize, perturbations: Vec<Perturbation>, plan: CompiledPlan) -> AlternativeCandidate {
        AlternativeCandidate { id, source_waypoint: source_wp, perturbations, plan }
    }

    /// Aplicar perturbación a una trayectoria completa (clona si es necesario).
    fn apply_perturbation_to_trajectory(
        trajectory: &thalos_core::trajectory::Trajectory,
        waypoint_idx: usize,
        joint_idx: usize,
        delta: f64,
    ) -> thalos_core::trajectory::Trajectory {
        let original = trajectory.waypoints();
        let mut new_waypoints: Vec<thalos_core::trajectory::TrajectoryPoint> = Vec::with_capacity(original.len());
        for (i, wp) in original.iter().enumerate() {
            if i == waypoint_idx {
                let mut joints = wp.joints().to_vec();
                if joint_idx < joints.len() {
                    joints[joint_idx] += delta;
                }
                new_waypoints.push(thalos_core::trajectory::TrajectoryPoint::new(joints, wp.timestamp()));
            } else {
                new_waypoints.push(thalos_core::trajectory::TrajectoryPoint::new(wp.joints().to_vec(), wp.timestamp()));
            }
        }
        thalos_core::trajectory::Trajectory::new(new_waypoints)
    }

    /// Aplicar una perturbación articular a un waypoint específico.
    fn apply_perturbation(
        plan: &CompiledPlan,
        waypoint_idx: usize,
        joint_idx: usize,
        delta: f64,
    ) -> CompiledPlan {
        let original = plan.merged_trajectory.waypoints();
        let mut new_waypoints: Vec<TrajectoryPoint> = Vec::with_capacity(original.len());

        for (i, wp) in original.iter().enumerate() {
            if i == waypoint_idx {
                let mut joints = wp.joints().to_vec();
                if joint_idx < joints.len() {
                    joints[joint_idx] += delta;
                }
                new_waypoints.push(TrajectoryPoint::new(joints, wp.timestamp()));
            } else {
                new_waypoints.push(TrajectoryPoint::new(
                    wp.joints().to_vec(),
                    wp.timestamp(),
                ));
            }
        }

        CompiledPlan {
            merged_trajectory: Trajectory::new(new_waypoints),
            segments: plan.segments.clone(),
            duration: plan.duration,
            waypoint_count: plan.waypoint_count,
        }
    }

    /// Evaluar y rankear una lista de candidatos contra el plan original.
    ///
    /// Cada candidato se analiza con [`TrajectoryAnalyzer`] completo (FK, Jacobiano,
    /// singularidad, manipulabilidad, colisiones) para producir métricas comparables
    /// a las del plan original.
    ///
    /// Retorna los candidatos ordenados por score ascendente (mejor primero).
    /// Cada entrada incluye el score original para comparación.
    pub fn rank_candidates(
        analyzer: &TrajectoryAnalyzer,
        original_metrics: &PlanMetrics,
        candidates: Vec<AlternativeCandidate>,
        cost_function: &CostFunction,
    ) -> Result<Vec<RankedAlternative>, PlanningError> {
        let original_score = cost_function.score(original_metrics);

        // Evaluar cada candidato con análisis completo
        let mut scored: Vec<(AlternativeCandidate, PlanScore)> = candidates
            .into_iter()
            .filter_map(|c| {
                let analysis = match analyzer.analyze(&c.plan.merged_trajectory) {
                    Ok(a) => a,
                    Err(e) => return Some(Err(e)),
                };
                let metrics = PlanEvaluator::compute_metrics(&analysis.waypoints);
                let score = cost_function.score(&metrics);
                Some(Ok((c, score)))
            })
            .collect::<Result<Vec<_>, _>>()?;

        // Ordenar por score ascendente
        scored.sort_by(|a, b| a.1.total.partial_cmp(&b.1.total).unwrap_or(std::cmp::Ordering::Equal));

        // Construir ranked alternatives con mejoras explicadas
        Ok(scored
            .into_iter()
            .enumerate()
            .map(|(rank, (candidate, score))| {
                let improvements = Self::compute_improvements(&original_score, &score);
                RankedAlternative {
                    rank: rank + 1,
                    candidate,
                    original_score: original_score.clone(),
                    score,
                    improvements,
                }
            })
            .collect())
    }

    /// Calcular diferencias legibles entre el score original y el candidato.
    fn compute_improvements(original: &PlanScore, candidate: &PlanScore) -> Vec<String> {
        let mut improvements = Vec::new();

        for (kind, orig_val) in &original.breakdown {
            if let Some(cand_val) = candidate.breakdown.get(kind) {
                let diff = orig_val - cand_val;
                if diff.abs() > 0.01 {
                    let label = match kind {
                        MetricKind::PathLength => "path length",
                        MetricKind::Manipulability => "manipulability",
                        MetricKind::JointMargin => "joint margin",
                        MetricKind::CollisionRisk => "collision risk",
                        MetricKind::Smoothness => "smoothness",
                        MetricKind::OrientationChange => "orientation change",
                    };
                    if diff > 0.0 {
                        improvements.push(format!("+{}% better {}", (diff * 100.0).round(), label));
                    } else {
                        improvements.push(format!("{}% worse {}", (diff.abs() * 100.0).round(), label));
                    }
                }
            }
        }

        improvements
    }

    /// Aplicar perturbación a un waypoint de un plan completo, retornando un nuevo CompiledPlan.
    fn apply_perturbation(
        plan: &CompiledPlan,
        waypoint_idx: usize,
        joint_idx: usize,
        delta: f64,
    ) -> CompiledPlan {
        let original = plan.merged_trajectory.waypoints();
        let mut new_waypoints: Vec<TrajectoryPoint> = Vec::with_capacity(original.len());
        for (i, wp) in original.iter().enumerate() {
            if i == waypoint_idx {
                let mut joints = wp.joints().to_vec();
                if joint_idx < joints.len() {
                    joints[joint_idx] += delta;
                }
                new_waypoints.push(TrajectoryPoint::new(joints, wp.timestamp()));
            } else {
                new_waypoints.push(TrajectoryPoint::new(wp.joints().to_vec(), wp.timestamp()));
            }
        }
        CompiledPlan {
            merged_trajectory: Trajectory::new(new_waypoints),
            segments: plan.segments.clone(),
            duration: plan.duration,
            waypoint_count: plan.waypoint_count,
        }
    }

    /// Aplicar perturbación a un waypoint de una trayectoria, retornando una nueva Trajectory.
    fn apply_perturbation_to_trajectory(
        trajectory: &Trajectory,
        waypoint_idx: usize,
        joint_idx: usize,
        delta: f64,
    ) -> Trajectory {
        let original = trajectory.waypoints();
        let mut new_waypoints: Vec<TrajectoryPoint> = Vec::with_capacity(original.len());
        for (i, wp) in original.iter().enumerate() {
            if i == waypoint_idx {
                let mut joints = wp.joints().to_vec();
                if joint_idx < joints.len() {
                    joints[joint_idx] += delta;
                }
                new_waypoints.push(TrajectoryPoint::new(joints, wp.timestamp()));
            } else {
                new_waypoints.push(TrajectoryPoint::new(wp.joints().to_vec(), wp.timestamp()));
            }
        }
        Trajectory::new(new_waypoints)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::TrajectoryAnalyzer;
    use crate::finding::{Finding, FindingKind, Severity};
    use thalos_core::models::{RobotModel, RobotRegistry};

    fn sample_plan() -> CompiledPlan {
        let waypoints = vec![
            TrajectoryPoint::new(vec![0.0, 0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.3, 0.5, -0.2], 1.0),
            TrajectoryPoint::new(vec![0.6, 0.8, -0.3], 2.0),
            TrajectoryPoint::new(vec![0.9, 1.2, -0.4], 3.0),
        ];
        CompiledPlan {
            merged_trajectory: Trajectory::new(waypoints),
            segments: vec![],
            duration: 3.0,
            waypoint_count: 4,
        }
    }

    #[test]
    fn generate_produces_candidates() {
        let plan = sample_plan();
        let findings = vec![
            Finding {
                kind: FindingKind::LowManipulability,
                severity: Severity::Warning,
                waypoint: Some(2),
                value: Some(0.2),
                threshold: None,
                message: "Low manipulability".into(),
            },
        ];
        let strategy = PerturbationStrategy::default_mvp();

        let candidates = AlternativeGenerator::generate(&plan, &findings, &strategy);
        assert!(!candidates.is_empty());
        // 3 DOF × 2 direcciones = 6 candidatos para waypoint 2
        assert_eq!(candidates.len(), 6);

        // Verificar que todas las perturbaciones están en waypoint 2
        for c in &candidates {
            assert_eq!(c.source_waypoint, 2);
            assert_eq!(c.perturbations.len(), 1);
        }
    }

    #[test]
    fn generate_empty_findings() {
        let plan = sample_plan();
        let strategy = PerturbationStrategy::default_mvp();
        let candidates = AlternativeGenerator::generate(&plan, &[], &strategy);
        // Sin hallazgos → sin candidatos (ProblematicWaypoints)
        assert!(candidates.is_empty());
    }

    #[test]
    fn generate_all_waypoints() {
        let plan = sample_plan();
        let strategy = PerturbationStrategy {
            selection_policy: SelectionPolicy::AllWaypoints,
            delta: 0.05,
            max_candidates: 0,
            cost_weights: None,
        };
        let candidates = AlternativeGenerator::generate(&plan, &[], &strategy);
        // 4 waypoints × 3 DOF × 2 direcciones = 24 candidatos
        assert_eq!(candidates.len(), 24);
    }

    #[test]
    fn perturbation_actually_changes_joints() {
        let plan = sample_plan();
        let findings = vec![
            Finding {
                kind: FindingKind::LowManipulability,
                severity: Severity::Warning,
                waypoint: Some(1),
                value: Some(0.3),
                threshold: None,
                message: "".into(),
            },
        ];
        let strategy = PerturbationStrategy::default_mvp();
        let candidates = AlternativeGenerator::generate(&plan, &findings, &strategy);

        // El primer candidato debería tener joints modificados en waypoint 1
        let orig_wp = &plan.merged_trajectory.waypoints()[1];
        let cand_wp = &candidates[0].plan.merged_trajectory.waypoints()[1];

        // Algún joint debería ser diferente
        let any_diff = orig_wp.joints().iter().zip(cand_wp.joints()).any(|(a, b)| (a - b).abs() > 1e-6);
        assert!(any_diff);
    }

    #[test]
    fn max_candidates_limit() {
        let plan = sample_plan();
        let strategy = PerturbationStrategy {
            selection_policy: SelectionPolicy::AllWaypoints,
            delta: 0.05,
            max_candidates: 5,
            cost_weights: None,
        };
        let candidates = AlternativeGenerator::generate(&plan, &[], &strategy);
        assert_eq!(candidates.len(), 5);
    }

    #[test]
    fn rank_candidates_orders_by_score() {
        let chain = RobotRegistry::create_default(RobotModel::Planar3R);
        let plan = sample_plan();
        let findings = vec![
            Finding {
                kind: FindingKind::LowManipulability,
                severity: Severity::Warning,
                waypoint: Some(1),
                value: Some(0.3),
                threshold: None,
                message: "".into(),
            },
        ];
        let strategy = PerturbationStrategy::default_mvp();
        let candidates = AlternativeGenerator::generate(&plan, &findings, &strategy);

        let analyzer = TrajectoryAnalyzer::new(&chain, None);
        let original_analysis = analyzer
            .analyze(&plan.merged_trajectory)
            .expect("original analysis failed");
        let original_metrics = PlanEvaluator::compute_metrics(&original_analysis.waypoints);

        let cost = CostFunction::defaults();
        let ranked = AlternativeGenerator::rank_candidates(
            &analyzer,
            &original_metrics,
            candidates,
            &cost,
        )
        .expect("ranking failed");

        assert!(!ranked.is_empty());
        // Verificar que están ordenados por score ascendente
        for i in 1..ranked.len() {
            assert!(
                ranked[i - 1].score.total <= ranked[i].score.total,
                "Ranked alternatives should be sorted by score"
            );
        }

        // Cada ranked debe tener su rank
        for (i, alt) in ranked.iter().enumerate() {
            assert_eq!(alt.rank, i + 1);
        }
    }
}
