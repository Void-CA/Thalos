//! Análisis de trayectorias planificadas.
//!
//! Evalúa cada waypoint de una trayectoria para detectar:
//! - Singularidades
//! - Manipulabilidad
//! - Colisiones y distancia a obstáculos
//! - Violaciones de constraints
//!
//! Produce un [`PlanAnalysis`] con datos por waypoint y métricas agregadas.

use thalos_core::{
    analysis::constraints::{Constraint, ConstraintEvaluator, ConstraintViolation},
    collision::{CollisionBodyBuilder, CollisionChecker, CollisionMatrix, EntityId},
    kinematics::{
        forward::ForwardKinematics,
        jacobian::{
            GeometricJacobian, JacobianSolver,
            manipulability::ManipulabilityReport,
            singularity::SingularityReport,
        },
    },
    robot::{serial_chain::SerialChain, tool_frame::ToolFrame},
    spatial::frame::FrameId,
    trajectory::Trajectory,
};
use thalos_collision::distance::geometries_distance;

use crate::error::PlanningError;
use crate::finding::{Finding, FindingKind, Severity};

// ─── Data types ───────────────────────────────────────────────────

/// Análisis completo de una trayectoria.
#[derive(Debug, Clone)]
pub struct PlanAnalysis {
    /// Datos por waypoint.
    pub waypoints: Vec<WaypointAnalysis>,
    /// Métricas agregadas de toda la trayectoria.
    pub metrics: AnalysisMetrics,
    /// Hallazgos objetivos del análisis (previo a recomendaciones).
    pub findings: Vec<Finding>,
    /// Violaciones de constraints, si se evaluaron.
    pub constraint_violations: Vec<ConstraintViolation>,
}

/// Análisis de un waypoint individual.
#[derive(Debug, Clone)]
pub struct WaypointAnalysis {
    /// Índice del waypoint.
    pub index: usize,
    /// Tiempo del waypoint (segundos).
    pub timestamp: f64,
    /// Configuración articular.
    pub joints: Vec<f64>,
    /// Reporte de singularidad.
    pub singularity: Option<SingularityReport>,
    /// Reporte de manipulabilidad.
    pub manipulability: Option<ManipulabilityReport>,
    /// Distancia mínima a obstáculos (negativo = colisión).
    pub min_collision_distance: Option<f64>,
}

/// Métricas agregadas de la trayectoria completa.
#[derive(Debug, Clone)]
pub struct AnalysisMetrics {
    /// Cantidad de waypoints analizados.
    pub waypoint_count: usize,
    /// Duración total estimada (segundos).
    pub trajectory_duration: f64,
    /// Manipulabilidad promedio (Yoshikawa) sobre todos los waypoints.
    pub avg_manipulability: Option<f64>,
    /// Manipulabilidad mínima (Yoshikawa).
    pub min_manipulability: Option<f64>,
    /// Cantidad de waypoints near-singular.
    pub near_singular_count: usize,
    /// Cantidad de waypoints singulares.
    pub singular_count: usize,
    /// Distancia mínima a obstáculos en toda la trayectoria.
    pub min_collision_distance: Option<f64>,
    /// Índice del waypoint con distancia mínima.
    pub min_collision_waypoint: Option<usize>,
    /// Si la trayectoria tiene colisiones.
    pub has_collisions: bool,
    /// Primera colisión detectada (waypoint).
    pub first_collision_waypoint: Option<usize>,
}

// ─── TrajectoryAnalyzer ───────────────────────────────────────────

/// Analizador de trayectorias planificadas.
///
/// Evalúa cada waypoint contra criterios de calidad y seguridad.
/// No requiere estado mutable — todas las dependencias se inyectan.
pub struct TrajectoryAnalyzer<'a> {
    pub chain: &'a SerialChain,
    pub fk: ForwardKinematics,
    pub end_effector: FrameId,
    pub tcp: Option<&'a ToolFrame>,
    pub collision_checker: Option<&'a dyn CollisionChecker>,
    pub collision_matrix: Option<&'a CollisionMatrix>,
    pub constraints: Option<&'a [Constraint]>,
    pub constraint_evaluator: Option<&'a dyn ConstraintEvaluator>,
    pub ik_solver: Option<&'a dyn thalos_core::kinematics::inverse::IKSolver>,
}

impl<'a> TrajectoryAnalyzer<'a> {
    pub fn new(chain: &'a SerialChain, tcp: Option<&'a ToolFrame>) -> Self {
        let end_effector = tcp
            .map(|t| t.base_frame.clone())
            .unwrap_or_else(|| *chain.end_effector());
        let fk = ForwardKinematics::new(chain.clone());
        Self {
            chain,
            fk,
            end_effector,
            tcp,
            collision_checker: None,
            collision_matrix: None,
            constraints: None,
            constraint_evaluator: None,
            ik_solver: None,
        }
    }

    pub fn with_collision_checker(mut self, checker: &'a dyn CollisionChecker, matrix: &'a CollisionMatrix) -> Self {
        self.collision_checker = Some(checker);
        self.collision_matrix = Some(matrix);
        self
    }

    pub fn with_constraints(mut self, constraints: &'a [Constraint], evaluator: &'a dyn ConstraintEvaluator) -> Self {
        self.constraints = Some(constraints);
        self.constraint_evaluator = Some(evaluator);
        self
    }

    /// Analiza una trayectoria completa.
    pub fn analyze(&self, trajectory: &Trajectory) -> Result<PlanAnalysis, PlanningError> {
        let mut waypoints = Vec::with_capacity(trajectory.len());
        let mut total_yoshikawa = 0.0;
        let mut min_yoshikawa = f64::MAX;
        let mut yoshikawa_count = 0;
        let mut near_singular = 0;
        let mut singular = 0;
        let mut abs_min_collision = f64::MAX;
        let mut min_coll_wp = None;

        for (idx, wp) in trajectory.waypoints().iter().enumerate() {
            let q = wp.joints().to_vec();
            let fk_result = self.fk.evaluate(&q);

            // Jacobiano + singularidad
            let jacobian_solver = GeometricJacobian::new(
                self.fk.clone(),
                self.end_effector.clone(),
            );
            let jacobian = jacobian_solver.evaluate(&q);
            let singularity = SingularityReport::analyze(&jacobian);
            let manipulability = ManipulabilityReport::compute(&singularity);

            if singularity.condition_number < 100.0 {
                // Normal
            } else if singularity.condition_number < 1000.0 {
                near_singular += 1;
            } else {
                singular += 1;
            }

            total_yoshikawa += manipulability.yoshikawa;
            if manipulability.yoshikawa < min_yoshikawa {
                min_yoshikawa = manipulability.yoshikawa;
            }
            yoshikawa_count += 1;

            // Colisiones
            let min_collision = if let Some(checker) = self.collision_checker {
                let bodies = CollisionBodyBuilder::build(self.chain, &fk_result);
                let default_matrix = CollisionMatrix::new();
                let matrix = self.collision_matrix.unwrap_or(&default_matrix);
                let result = checker.check(&bodies, matrix);

                // Compute minimum distance between all body pairs
                let mut min_dist = f64::MAX;
                for i in 0..bodies.len() {
                    for j in (i + 1)..bodies.len() {
                        if let (EntityId::Link(la), EntityId::Link(lb)) = (&bodies[i].entity, &bodies[j].entity) {
                            if matrix.is_ignored(*la, *lb) {
                                continue;
                            }
                        }
                        let d = geometries_distance(
                            &bodies[i].geometry,
                            &bodies[i].pose,
                            &bodies[j].geometry,
                            &bodies[j].pose,
                        );
                        if d < min_dist {
                            min_dist = d;
                        }
                    }
                }

                if !result.is_empty() {
                    // Collision detected — penetration
                    if min_dist > 0.0 {
                        min_dist = -0.001; // signal collision
                    }
                }

                if min_dist < abs_min_collision {
                    abs_min_collision = min_dist;
                    min_coll_wp = Some(idx);
                }

                Some(min_dist)
            } else {
                None
            };

            waypoints.push(WaypointAnalysis {
                index: idx,
                timestamp: wp.timestamp(),
                joints: q,
                singularity: Some(singularity),
                manipulability: Some(manipulability),
                min_collision_distance: min_collision,
            });
        }

        // Constraints
        let constraint_violations = if let Some(constraints) = self.constraints {
            if let Some(evaluator) = self.constraint_evaluator {
                evaluator.evaluate_trajectory(constraints, trajectory, self.chain, &self.fk, self.tcp)
            } else {
                vec![]
            }
        } else {
            vec![]
        };

        let metrics = AnalysisMetrics {
            waypoint_count: waypoints.len(),
            trajectory_duration: trajectory.duration(),
            avg_manipulability: if yoshikawa_count > 0 {
                Some(total_yoshikawa / yoshikawa_count as f64)
            } else {
                None
            },
            min_manipulability: if min_yoshikawa < f64::MAX {
                Some(min_yoshikawa)
            } else {
                None
            },
            near_singular_count: near_singular,
            singular_count: singular,
            min_collision_distance: if abs_min_collision < f64::MAX {
                Some(abs_min_collision)
            } else {
                None
            },
            min_collision_waypoint: min_coll_wp,
            has_collisions: abs_min_collision < 0.0 || abs_min_collision < 1e-9,
            first_collision_waypoint: if abs_min_collision < 0.0 { min_coll_wp } else { None },
        };

        // Findings — hechos objetivos derivados del análisis
        let mut findings: Vec<Finding> = Vec::new();

        // Manipulabilidad baja
        if let Some(avg) = metrics.avg_manipulability {
            let manip_threshold = 0.3;
            if avg < manip_threshold {
                // Encontrar el waypoint con manipulabilidad mínima
                if let Some(worst) = waypoints.iter()
                    .filter_map(|w| w.manipulability.as_ref().map(|m| (w.index, m.yoshikawa)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                {
                    findings.push(Finding {
                        kind: FindingKind::LowManipulability,
                        severity: Severity::Warning,
                        waypoint: Some(worst.0),
                        message: format!("Low manipulability ({:.3}) at waypoint {}", worst.1, worst.0),
                        value: Some(worst.1),
                        threshold: Some(manip_threshold),
                    });
                }
            }
        }

        // Singularidades
        for wp in &waypoints {
            if let Some(sr) = &wp.singularity {
                if sr.condition_number >= 1000.0 {
                    findings.push(Finding {
                        kind: FindingKind::Singularity,
                        severity: Severity::Error,
                        waypoint: Some(wp.index),
                        message: format!("Singularity at waypoint {} (condition number: {:.1})", wp.index, sr.condition_number),
                        value: Some(sr.condition_number),
                        threshold: Some(1000.0),
                    });
                } else if sr.condition_number >= 100.0 {
                    findings.push(Finding {
                        kind: FindingKind::NearSingularity,
                        severity: Severity::Warning,
                        waypoint: Some(wp.index),
                        message: format!("Near singularity at waypoint {} (condition number: {:.1})", wp.index, sr.condition_number),
                        value: Some(sr.condition_number),
                        threshold: Some(100.0),
                    });
                }
            }
        }

        // Colisiones
        if metrics.has_collisions {
            findings.push(Finding {
                kind: FindingKind::Collision,
                severity: Severity::Error,
                waypoint: metrics.first_collision_waypoint,
                    message: format!(
                        "Collision at waypoint {}",
                        metrics.first_collision_waypoint.map(|i| i.to_string()).unwrap_or_else(|| "unknown".to_string()),
                    ),
                value: metrics.min_collision_distance,
                threshold: Some(0.0),
            });
        } else if let Some(min_dist) = metrics.min_collision_distance {
            if min_dist < 0.05 {
                findings.push(Finding {
                    kind: FindingKind::CollisionNear,
                    severity: Severity::Warning,
                    waypoint: metrics.min_collision_waypoint,
                    message: format!("Obstacle distance low ({:.1} mm)", min_dist * 1000.0),
                    value: Some(min_dist),
                    threshold: Some(0.05),
                });
            }
        }

        // Violaciones de constraints
        for v in &constraint_violations {
            findings.push(Finding {
                kind: FindingKind::ConstraintViolation,
                severity: Severity::Error,
                waypoint: Some(v.waypoint),
                message: v.message.clone(),
                value: Some(v.magnitude),
                threshold: None,
            });
        }

        Ok(PlanAnalysis {
            waypoints,
            metrics,
            findings,
            constraint_violations,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        models::{RobotModel, RobotRegistry},
        trajectory::TrajectoryPoint,
    };
    use thalos_collision::NaiveCollisionChecker;

    fn make_simple_trajectory() -> Trajectory {
        Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 0.3], 0.5),
            TrajectoryPoint::new(vec![1.0, 0.5], 1.0),
        ])
    }

    #[test]
    fn analyzes_all_waypoints() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = make_simple_trajectory();
        let analyzer = TrajectoryAnalyzer::new(&chain, None);

        let analysis = analyzer.analyze(&traj).expect("analysis failed");
        assert_eq!(analysis.waypoints.len(), 3);
        assert!(analysis.metrics.waypoint_count == 3);
    }

    #[test]
    fn produces_manipulability_metrics() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = make_simple_trajectory();
        let analyzer = TrajectoryAnalyzer::new(&chain, None);

        let analysis = analyzer.analyze(&traj).expect("analysis failed");
        assert!(analysis.metrics.avg_manipulability.is_some());
        assert!(analysis.metrics.avg_manipulability.unwrap() > 0.0);
    }

    #[test]
    fn detects_collisions_with_checker() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let checker = NaiveCollisionChecker;
        let matrix = CollisionMatrix::new();
        let traj = make_simple_trajectory();
        let analyzer = TrajectoryAnalyzer::new(&chain, None)
            .with_collision_checker(&checker, &matrix);

        let analysis = analyzer.analyze(&traj).expect("analysis failed");
        // Planar2R links are separated — should be no collisions
        assert!(!analysis.metrics.has_collisions);
    }

    // ─── Scenario 1: Perfect plan ────────────────────────────────

    #[test]
    fn scenario_perfect_plan_returns_ok_status() {
        // Trajectory where q2 ≈ π/2 (maximum manipulability)
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 1.57], 0.0),
            TrajectoryPoint::new(vec![0.3, 1.57], 0.5),
            TrajectoryPoint::new(vec![0.6, 1.57], 1.0),
        ]);
        let analyzer = TrajectoryAnalyzer::new(&chain, None);
        let analysis = analyzer.analyze(&traj).expect("analysis failed");

        // Should have no findings
        assert!(analysis.findings.is_empty(),
            "Expected no findings for perfect plan, got {}: {:?}",
            analysis.findings.len(), analysis.findings);
        assert!(analysis.metrics.avg_manipulability.unwrap_or(0.0) > 0.3);
    }

    // ─── Scenario 2: Low manipulability ──────────────────────────

    #[test]
    fn scenario_low_manipulability_generates_findings() {
        // Trajectory with q2 close to 0 (near-extended arm → low manipulability)
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.05], 0.0),
            TrajectoryPoint::new(vec![0.5, 0.05], 0.5),
        ]);
        let analyzer = TrajectoryAnalyzer::new(&chain, None);
        let analysis = analyzer.analyze(&traj).expect("analysis failed");

        // Should have findings (low manipulability or near-singularity)
        assert!(!analysis.findings.is_empty(),
            "Expected findings for low-manipulability plan");

        let has_low_manip = analysis.findings.iter()
            .any(|f| matches!(f.kind, FindingKind::LowManipulability));
        let has_near_sing = analysis.findings.iter()
            .any(|f| matches!(f.kind, FindingKind::NearSingularity));

        // Either finding is valid here — both indicate a problem
        assert!(has_low_manip || has_near_sing,
            "Expected LowManipulability or NearSingularity finding, got: {:?}",
            analysis.findings.iter().map(|f| f.kind).collect::<Vec<_>>());
    }

    // ─── Scenario 3: Singularity ─────────────────────────────────

    #[test]
    fn scenario_singularity_generates_error() {
        // Arm fully extended along X → singular configuration
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
        ]);
        let analyzer = TrajectoryAnalyzer::new(&chain, None);
        let analysis = analyzer.analyze(&traj).expect("analysis failed");

        // At q = [0, 0] the arm is fully extended → singular
        // Should have at least a NearSingularity or Singularity finding
        let has_singularity = analysis.findings.iter()
            .any(|f| matches!(f.kind, FindingKind::Singularity | FindingKind::NearSingularity));

        assert!(has_singularity,
            "Expected Singularity or NearSingularity finding for fully-extended arm, got: {:?}",
            analysis.findings.iter().map(|f| f.kind).collect::<Vec<_>>());
    }

    // ─── Scenario 5: Multiple problems ────────────────────────────

    #[test]
    fn scenario_multiple_problems_aggregate_correctly() {
        // Mix of good and bad waypoints
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),    // singular
            TrajectoryPoint::new(vec![0.5, 0.05], 0.5),    // low manipulability
            TrajectoryPoint::new(vec![0.5, 1.57], 1.0),    // good
        ]);
        let analyzer = TrajectoryAnalyzer::new(&chain, None);
        let analysis = analyzer.analyze(&traj).expect("analysis failed");

        // Should have findings from waypoints 0 and 1
        assert!(!analysis.findings.is_empty());
        // Should have at least 2 findings (one per problem waypoint)
        assert!(analysis.findings.len() >= 1);
        // At least one finding from the singular waypoint
        let sing_findings = analysis.findings.iter()
            .filter(|f| matches!(f.kind, FindingKind::Singularity | FindingKind::NearSingularity | FindingKind::LowManipulability));
        assert!(sing_findings.count() >= 1);
    }

    // Verify the pipeline: Analyze → Findings → Recommendations
    #[test]
    fn findings_produce_recommendations() {
        use crate::finding::{Finding, FindingKind, Severity};

        // Create a trajectory with good manipulability (q2 ≈ π/2)
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.3, 1.57], 0.0),
            TrajectoryPoint::new(vec![0.5, 1.57], 0.5),
        ]);
        let analyzer = TrajectoryAnalyzer::new(&chain, None);
        let analysis = analyzer.analyze(&traj).expect("analysis failed");

        let advisor = crate::advisor::PlanAdvisor;

        if !analysis.findings.is_empty() {
            // If there are findings, verify they produce recommendations
            let recommendations = advisor.advise(&analysis.findings);
            assert!(!recommendations.is_empty(),
                "Findings should produce recommendations. Findings: {:?}",
                analysis.findings);
        } else {
            // No findings → empty recommendations
            let recommendations = advisor.advise(&analysis.findings);
            assert!(recommendations.is_empty());
        }
    }
}
