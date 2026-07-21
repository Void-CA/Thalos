//! Generación de planes candidatos por perturbación determinista.
//!
//! Toma un plan existente + hallazgos del análisis, y produce variantes
//! modificando waypoints problemáticos. Cada variante se evalúa con el
//! `PlanEvaluator` para producir un ranking.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use thalos_core::trajectory::{Trajectory, TrajectoryPoint};

use crate::evaluation::cost::{CostFunction, PlanScore};
use crate::evaluation::evaluator::PlanEvaluator;
use crate::evaluation::metrics::{MetricKind, PlanMetrics};
use crate::finding::Finding;
use crate::motion::program::CompiledPlan;

/// Regiones problemáticas de un plan — desacopla el generador del análisis.
///
/// El análisis produce `Vec<Finding>`. El generador consume `ProblemRegions`.
/// Entre ambos, una conversión explícita extrae solo los waypoints relevantes.
#[derive(Debug, Clone)]
pub struct ProblemRegions {
    /// Índices de waypoints con problemas, ordenados.
    pub waypoints: Vec<usize>,
}

impl ProblemRegions {
    /// Crear desde hallazgos del análisis.
    pub fn from_findings(findings: &[Finding]) -> Self {
        let mut indices: Vec<usize> = findings.iter().filter_map(|f| f.waypoint).collect();
        indices.sort();
        indices.dedup();
        Self { waypoints: indices }
    }

    /// Crear desde una lista explícita de waypoints.
    pub fn from_indices(indices: Vec<usize>) -> Self {
        let mut indices = indices;
        indices.sort();
        indices.dedup();
        Self { waypoints: indices }
    }

    /// Crear región vacía (sin problemas).
    pub fn none() -> Self {
        Self { waypoints: vec![] }
    }

    pub fn is_empty(&self) -> bool {
        self.waypoints.is_empty()
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
    /// No depende del formato completo del análisis — solo recibe los
    /// índices de waypoints problemáticos.
    pub fn generate_from_regions(
        plan: &CompiledPlan,
        regions: &ProblemRegions,
        strategy: &PerturbationStrategy,
    ) -> Vec<AlternativeCandidate> {
        let waypoints = plan.merged_trajectory.waypoints();
        if waypoints.is_empty() {
            return vec![];
        }

        let target_indices: Vec<usize> = match strategy.selection_policy {
            SelectionPolicy::ProblematicWaypoints => regions.waypoints.clone(),
            SelectionPolicy::AllWaypoints => {
                (0..waypoints.len()).collect()
            }
        };

        if target_indices.is_empty() {
            return vec![];
        }

        let dof = waypoints.first().map(|wp| wp.joints().len()).unwrap_or(0);

        let mut candidates: Vec<AlternativeCandidate> = Vec::new();
        let mut next_id = 0;

        for &wp_idx in &target_indices {
            if !strategy.max_candidates == 0 && candidates.len() >= strategy.max_candidates {
                break;
            }

            // Para cada articulación en este waypoint, probar ±delta
            for joint in 0..dof {
                for &delta in &[strategy.delta, -strategy.delta] {
                    if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates {
                        break;
                    }

                    let modified = Self::apply_perturbation(plan, wp_idx, joint, delta);
                    candidates.push(AlternativeCandidate {
                        id: next_id,
                        source_waypoint: wp_idx,
                        perturbations: vec![Perturbation {
                            waypoint: wp_idx,
                            joint,
                            delta,
                        }],
                        plan: modified,
                    });
                    next_id += 1;
                }
                if strategy.max_candidates > 0 && candidates.len() >= strategy.max_candidates {
                    break;
                }
            }
        }

        candidates
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
    /// Retorna los candidatos ordenados por score ascendente (mejor primero).
    /// Cada entrada incluye el score original para comparación.
    pub fn rank_candidates(
        original_metrics: &PlanMetrics,
        candidates: Vec<AlternativeCandidate>,
        cost_function: &CostFunction,
    ) -> Vec<RankedAlternative> {
        let original_score = cost_function.score(original_metrics);

        // Evaluar cada candidato
        let mut scored: Vec<(AlternativeCandidate, PlanScore)> = candidates
            .into_iter()
            .filter_map(|c| {
                // Necesitamos WaypointAnalysis para evaluar — por ahora usamos
                // las métricas del original y las ajustamos basado en la perturbación.
                // En el futuro, el evaluador recibirá WaypointAnalysis real.
                // Para el MVP, computamos métricas desde los waypoints modificados.
                let metrics = PlanEvaluator::compute_metrics_from_joints(
                    &c.plan.merged_trajectory,
                );
                let score = cost_function.score(&metrics);
                Some((c, score))
            })
            .collect();

        // Ordenar por score ascendente
        scored.sort_by(|a, b| a.1.total.partial_cmp(&b.1.total).unwrap_or(std::cmp::Ordering::Equal));

        // Construir ranked alternatives con mejoras explicadas
        scored
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
            .collect()
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluation::metrics::PlanMetrics;
    use crate::finding::{Finding, FindingKind, Severity};
    use std::collections::HashMap;

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

        let original_metrics = PlanEvaluator::compute_metrics_from_joints(&plan.merged_trajectory);
        let cost = CostFunction::defaults();
        let ranked = AlternativeGenerator::rank_candidates(&original_metrics, candidates, &cost);

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
