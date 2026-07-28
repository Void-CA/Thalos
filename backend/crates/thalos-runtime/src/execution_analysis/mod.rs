//! Análisis de ejecuciones comparadas contra el plan.
//!
//! El [`ExecutionAnalyzer`] toma un [`PlanExecutionComparison`] (plan vs ejecución)
//! y produce [`Finding`] en el mismo lenguaje que el sistema experto de planificación.
//!
//! Esto cierra el feedback loop:
//!   Comparison → ExecutionAnalyzer → Findings → ProblemRegions → RepairPlanner
//!
//! Los hallazgos son a nivel de plan (sin waypoint específico) en el MVP.
//! Versiones futuras podrán mapear picos de error a waypoints concretos.

use thalos_planning::finding::{Finding, FindingKind, Severity};

use crate::comparison::PlanExecutionComparison;

/// Umbrales por defecto para detección de problemas de ejecución.
///
/// Se pueden ajustar pasando un `ExecutionThresholds` personalizado.
pub struct ExecutionThresholds {
    /// RMSE global por encima del cual se considera error de tracking severo.
    pub global_rmse_warning: f64,
    /// Error máximo absoluto por encima del cual se genera un TrackingSpike.
    pub max_error_spike: f64,
    /// Error máximo por articulación que dispara un JointDeviation.
    pub joint_max_error_warning: f64,
    /// Desviación de velocidad máxima por articulación (rad/s).
    pub velocity_deviation_warning: f64,
}

impl Default for ExecutionThresholds {
    fn default() -> Self {
        Self {
            global_rmse_warning: 0.05,       // 0.05 rad ≈ 2.86°
            max_error_spike: 0.10,           // 0.10 rad ≈ 5.73°
            joint_max_error_warning: 0.10,   // 0.10 rad por articulación
            velocity_deviation_warning: 1.0, // 1 rad/s
        }
    }
}

/// Analiza una comparación plan-vs-ejecución y produce hallazgos objetivos.
///
/// Sigue el mismo principio que `PlanAdvisor`:
/// - Nunca recalcula datos que ya están en el comparison
/// - Solo interpreta y clasifica
pub struct ExecutionAnalyzer {
    thresholds: ExecutionThresholds,
}

impl ExecutionAnalyzer {
    /// Crear con umbrales por defecto.
    pub fn new() -> Self {
        Self {
            thresholds: ExecutionThresholds::default(),
        }
    }

    /// Crear con umbrales personalizados.
    pub fn with_thresholds(thresholds: ExecutionThresholds) -> Self {
        Self { thresholds }
    }

    /// Analizar una comparación y producir hallazgos.
    ///
    /// Evalúa:
    /// - Error de tracking global (RMSE)
    /// - Picos de error máximo
    /// - Desviaciones por articulación
    /// - Desviaciones de velocidad
    pub fn analyze(&self, comparison: &PlanExecutionComparison) -> Vec<Finding> {
        let mut findings = Vec::new();
        let metrics = &comparison.metrics;

        // Nivel mínimo de severidad: no tiene sentido analizar si no hay datos
        if metrics.aligned_count == 0 {
            return findings;
        }

        // 1. Error de tracking global (RMSE)
        if metrics.global_rmse > self.thresholds.global_rmse_warning {
            findings.push(Finding {
                kind: FindingKind::TrackingError,
                severity: Severity::Warning,
                waypoint: None,
                message: format!(
                    "Global tracking RMSE {:.4} rad exceeds threshold {:.4} rad. \
                     The robot did not follow the planned path closely.",
                    metrics.global_rmse, self.thresholds.global_rmse_warning,
                ),
                value: Some(metrics.global_rmse),
                threshold: Some(self.thresholds.global_rmse_warning),
            });
        }

        // 2. Pico de error máximo
        if metrics.global_max_error > self.thresholds.max_error_spike {
            findings.push(Finding {
                kind: FindingKind::TrackingSpike,
                severity: Severity::Warning,
                waypoint: None,
                message: format!(
                    "Maximum tracking error {:.4} rad exceeds spike threshold {:.4} rad. \
                     A sharp deviation occurred during execution.",
                    metrics.global_max_error, self.thresholds.max_error_spike,
                ),
                value: Some(metrics.global_max_error),
                threshold: Some(self.thresholds.max_error_spike),
            });
        }

        // 3. Desviaciones por articulación
        for (j, &max_err) in metrics.per_joint.max_error.iter().enumerate() {
            if max_err > self.thresholds.joint_max_error_warning {
                findings.push(Finding {
                    kind: FindingKind::JointDeviation,
                    severity: Severity::Warning,
                    waypoint: None,
                    message: format!(
                        "Joint {} max tracking error {:.4} rad exceeds threshold {:.4} rad.",
                        j, max_err, self.thresholds.joint_max_error_warning,
                    ),
                    value: Some(max_err),
                    threshold: Some(self.thresholds.joint_max_error_warning),
                });
            }
        }

        // 4. Desviaciones de velocidad
        for (j, &max_vel_dev) in metrics.max_velocity_deviation.iter().enumerate() {
            if max_vel_dev > self.thresholds.velocity_deviation_warning {
                findings.push(Finding {
                    kind: FindingKind::VelocityDeviation,
                    severity: Severity::Info,
                    waypoint: None,
                    message: format!(
                        "Joint {} max velocity deviation {:.4} rad/s exceeds threshold {:.4} rad/s.",
                        j, max_vel_dev, self.thresholds.velocity_deviation_warning,
                    ),
                    value: Some(max_vel_dev),
                    threshold: Some(self.thresholds.velocity_deviation_warning),
                });
            }
        }

        findings
    }
}

impl Default for ExecutionAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comparison::compare;
    use crate::motion_trace::{MotionSample, MotionTrace};
    use crate::session::ExecutionSource;
    use crate::telemetry::{ExecutionSample, ExecutionTrace, TraceMetadata};
    use std::time::Duration;

    fn make_perfect_trace() -> (MotionTrace, ExecutionTrace) {
        let mut plan = MotionTrace::new();

        for i in 0..5 {
            let t = Duration::from_secs_f64(i as f64 * 0.1);
            let joints = vec![0.1 * i as f64, 0.05 * i as f64];
            plan.push(MotionSample {
                timestamp: t,
                joints: joints.clone(),
                velocities: vec![0.1, 0.05],
                target_joints: None,
                progress: i as f64 / 4.0,
                errors: vec![],
            });
        }

        let meta = TraceMetadata {
            session_id: "test".into(),
            plan_id: "p1".into(),
            source: ExecutionSource::Simulation,
            robot_name: "test".into(),
            joint_count: 2,
            duration: Duration::from_secs_f64(0.4),
            sample_rate: 10.0,
        };
        let mut trace = ExecutionTrace::new(meta);
        for i in 0..5 {
            let t = Duration::from_secs_f64(i as f64 * 0.1);
            trace.push_sample(ExecutionSample {
                timestamp: t,
                joints: vec![0.1 * i as f64, 0.05 * i as f64], // identical to plan
                velocities: vec![0.1, 0.05],
                accelerations: vec![],
                tcp_pose: [0.0; 7],
                tcp_velocity: [0.0; 6],
                tracking_error: None,
                progress: i as f64 / 4.0,
            });
        }
        (plan, trace)
    }

    fn make_deviated_trace() -> (MotionTrace, ExecutionTrace) {
        let mut plan = MotionTrace::new();
        let mut exec_samples = vec![];

        for i in 0..5 {
            let t = Duration::from_secs_f64(i as f64 * 0.1);
            let joints = vec![0.1 * i as f64, 0.05 * i as f64];
            plan.push(MotionSample {
                timestamp: t,
                joints: joints.clone(),
                velocities: vec![0.1, 0.05],
                target_joints: None,
                progress: i as f64 / 4.0,
                errors: vec![],
            });
            // Execution deviates at sample 2 and 3
            let exec_joints = if i >= 2 {
                vec![0.1 * i as f64 + 0.15, 0.05 * i as f64 - 0.12]
            } else {
                joints
            };
            exec_samples.push(ExecutionSample {
                timestamp: t,
                joints: exec_joints,
                velocities: vec![0.1, 0.05],
                accelerations: vec![],
                tcp_pose: [0.0; 7],
                tcp_velocity: [0.0; 6],
                tracking_error: Some(0.08),
                progress: i as f64 / 4.0,
            });
        }

        let meta = TraceMetadata {
            session_id: "test".into(),
            plan_id: "p1".into(),
            source: ExecutionSource::Simulation,
            robot_name: "test".into(),
            joint_count: 2,
            duration: Duration::from_secs_f64(0.4),
            sample_rate: 10.0,
        };
        let mut trace = ExecutionTrace::new(meta);
        for s in exec_samples {
            trace.push_sample(s);
        }
        (plan, trace)
    }

    #[test]
    fn no_findings_for_perfect_execution() {
        let (plan, exec) = make_perfect_trace();
        let comparison = compare(&plan, &exec, "p1", "e1", "test");
        let analyzer = ExecutionAnalyzer::new();
        let findings = analyzer.analyze(&comparison);

        assert!(
            findings.is_empty(),
            "Perfect execution should produce no findings, got: {:?}",
            findings
        );
    }

    #[test]
    fn detects_tracking_error_from_deviation() {
        let (plan, exec) = make_deviated_trace();
        let comparison = compare(&plan, &exec, "p1", "e1", "test");
        let analyzer = ExecutionAnalyzer::new();
        let findings = analyzer.analyze(&comparison);

        // Should detect global tracking error
        let has_tracking_error = findings
            .iter()
            .any(|f| matches!(f.kind, FindingKind::TrackingError));
        assert!(
            has_tracking_error,
            "Deviated execution should produce TrackingError"
        );

        // Should detect joint-level deviations
        let has_joint_deviation = findings
            .iter()
            .any(|f| matches!(f.kind, FindingKind::JointDeviation));
        assert!(
            has_joint_deviation,
            "Deviated execution should produce JointDeviation"
        );

        // Should produce at least 2 findings
        assert!(
            findings.len() >= 2,
            "Expected >= 2 findings, got {}",
            findings.len()
        );
    }

    #[test]
    fn empty_comparison_produces_no_findings() {
        let plan = MotionTrace::new();
        let meta = TraceMetadata {
            session_id: "e".into(),
            plan_id: "p".into(),
            source: ExecutionSource::Simulation,
            robot_name: "".into(),
            joint_count: 0,
            duration: Duration::ZERO,
            sample_rate: 0.0,
        };
        let exec = crate::telemetry::ExecutionTrace::new(meta);
        let comparison = compare(&plan, &exec, "", "", "");
        let analyzer = ExecutionAnalyzer::new();
        let findings = analyzer.analyze(&comparison);

        assert!(findings.is_empty());
    }

    #[test]
    fn custom_thresholds_affect_sensitivity() {
        let (plan, exec) = make_deviated_trace();
        let comparison = compare(&plan, &exec, "p1", "e1", "test");

        // Very permissive thresholds
        let permissive = ExecutionThresholds {
            global_rmse_warning: 1.0,
            max_error_spike: 2.0,
            joint_max_error_warning: 2.0,
            velocity_deviation_warning: 10.0,
        };
        let analyzer = ExecutionAnalyzer::with_thresholds(permissive);
        let findings = analyzer.analyze(&comparison);

        assert!(
            findings.is_empty(),
            "Permissive thresholds should produce no findings"
        );

        // Very strict thresholds
        let strict = ExecutionThresholds {
            global_rmse_warning: 0.001,
            max_error_spike: 0.001,
            joint_max_error_warning: 0.001,
            velocity_deviation_warning: 0.001,
        };
        let analyzer = ExecutionAnalyzer::with_thresholds(strict);
        let findings = analyzer.analyze(&comparison);

        assert!(
            !findings.is_empty(),
            "Strict thresholds should produce findings"
        );
    }

    #[test]
    fn findings_use_correct_kinds() {
        let (plan, exec) = make_deviated_trace();
        let comparison = compare(&plan, &exec, "p1", "e1", "test");
        let analyzer = ExecutionAnalyzer::new();
        let findings = analyzer.analyze(&comparison);

        for f in &findings {
            match f.kind {
                FindingKind::TrackingError
                | FindingKind::TrackingSpike
                | FindingKind::JointDeviation
                | FindingKind::VelocityDeviation => {
                    // These are the expected kinds from ExecutionAnalyzer
                }
                other => {
                    panic!(
                        "Unexpected finding kind from ExecutionAnalyzer: {:?}",
                        other
                    );
                }
            }
        }
    }
}
