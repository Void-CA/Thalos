//! Hallazgos objetivos del análisis de una trayectoria.
//!
//! Un [`Finding`] representa un hecho objetivo detectado por el análisis:
//! "manipulabilidad baja en waypoint 3", "distancia a obstáculo < umbral",
//! "singularidad detectada". Son la materia prima que el [`Advisor`](crate::advisor::PlanAdvisor)
//! consume para generar [`Recommendation`](crate::advisor::Recommendation).
//!
//! La separación Finding → Recommendation es deliberada:
//! - Los Findings los produce el [`TrajectoryAnalyzer`](crate::analysis::TrajectoryAnalyzer)
//! - Las Recommendations las produce el [`PlanAdvisor`](crate::advisor::PlanAdvisor)
//! - El Advisor nunca recalcula, solo interpreta Findings

use std::fmt;

/// Severidad del hallazgo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Severity::Info => write!(f, "info"),
            Severity::Warning => write!(f, "warning"),
            Severity::Error => write!(f, "error"),
        }
    }
}

/// Tipo de hallazgo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FindingKind {
    LowManipulability,
    NearSingularity,
    Singularity,
    Collision,
    CollisionNear,
    ConstraintViolation,
    IkSuggestion,
    /// Error de tracking global alto (RMSE > umbral).
    TrackingError,
    /// Pico de error de tracking en un punto específico.
    TrackingSpike,
    /// Articulación específica con desviación anormal.
    JointDeviation,
    /// Desviación de velocidad en una articulación.
    VelocityDeviation,
}

impl fmt::Display for FindingKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FindingKind::LowManipulability => write!(f, "low_manipulability"),
            FindingKind::NearSingularity => write!(f, "near_singularity"),
            FindingKind::Singularity => write!(f, "singularity"),
            FindingKind::Collision => write!(f, "collision"),
            FindingKind::CollisionNear => write!(f, "collision_near"),
            FindingKind::ConstraintViolation => write!(f, "constraint_violation"),
            FindingKind::IkSuggestion => write!(f, "ik_suggestion"),
            FindingKind::TrackingError => write!(f, "tracking_error"),
            FindingKind::TrackingSpike => write!(f, "tracking_spike"),
            FindingKind::JointDeviation => write!(f, "joint_deviation"),
            FindingKind::VelocityDeviation => write!(f, "velocity_deviation"),
        }
    }
}

/// Un hallazgo objetivo del análisis de trayectoria.
///
/// Representa un hecho, no una acción. Ejemplos:
/// - "manipulabilidad = 0.12 en waypoint 3" (Finding)
/// - vs "cambiar solución IK" (Recommendation)
#[derive(Debug, Clone)]
pub struct Finding {
    pub kind: FindingKind,
    pub severity: Severity,
    pub waypoint: Option<usize>,
    pub message: String,
    /// Valor numérico asociado (manipulabilidad, distancia, condition number, etc.)
    pub value: Option<f64>,
    /// Umbral que se superó para generar este finding.
    pub threshold: Option<f64>,
}
