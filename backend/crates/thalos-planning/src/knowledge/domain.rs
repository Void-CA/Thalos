//! Tipos de dominio del conocimiento de planificación.
//!
//! `PlanningKnowledge` es un contenedor inmutable con dos niveles:
//! - `RobotKnowledge`: datos estáticos del robot (permanente)
//! - `WorkspaceKnowledge`: datos derivados del workspace (por sesión)

use thalos_core::spatial::frame::FrameId;
use crate::analysis::domain::RegionSeverity;

/// Conocimiento completo disponible para planificación.
#[derive(Debug, Clone)]
pub struct PlanningKnowledge {
    /// Conocimiento estático del robot.
    pub robot: RobotKnowledge,
    /// Conocimiento del workspace (None si no se ha generado).
    pub workspace: Option<WorkspaceKnowledge>,
}

/// Conocimiento estático derivado del modelo del robot.
/// Ciclo de vida: mientras el robot esté cargado.
#[derive(Debug, Clone)]
pub struct RobotKnowledge {
    pub dof: usize,
    pub joint_limits: Vec<JointLimit>,
    pub tcp_frame: FrameId,
}

/// Conocimiento derivado del workspace.
/// Ciclo de vida: mientras la escena no cambie.
#[derive(Debug, Clone)]
pub struct WorkspaceKnowledge {
    pub reachability: Option<ReachabilityMap>,
    pub manipulability: Option<ManipulabilityField>,
    pub singularity_zones: Vec<SingularityZone>,
    pub preferred_configs: Vec<ConfigurationRegion>,
}

/// Límite de un joint individual.
#[derive(Debug, Clone, Copy)]
pub struct JointLimit {
    pub min: f64,
    pub max: f64,
}

/// Región de singularidad conocida en espacio articular.
#[derive(Debug, Clone)]
pub struct SingularityZone {
    pub id: usize,
    pub center: Vec<f64>,
    pub radius: f64,
    pub severity: RegionSeverity,
    pub source: SingularitySource,
}

impl SingularityZone {
    pub fn contains(&self, q: &[f64]) -> bool {
        if q.len() != self.center.len() {
            return false;
        }
        let dist: f64 = q.iter()
            .zip(&self.center)
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        dist <= self.radius
    }
}

/// Origen de una zona de singularidad.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SingularitySource {
    Sampling,
    RuntimeDetection,
}

/// Región del espacio articular con buena manipulabilidad.
#[derive(Debug, Clone)]
pub struct ConfigurationRegion {
    pub center: Vec<f64>,
    pub radius: f64,
    pub manipulability_score: f64,
}

/// Mapa de alcanzabilidad espacial.
#[derive(Debug, Clone)]
pub struct ReachabilityMap {
    pub samples: Vec<ReachabilitySample>,
}

#[derive(Debug, Clone)]
pub struct ReachabilitySample {
    pub position: thalos_math::Vector3,
    pub reachable: bool,
}

/// Campo de manipulabilidad espacial.
#[derive(Debug, Clone)]
pub struct ManipulabilityField {
    pub samples: Vec<ManipulabilitySample>,
}

#[derive(Debug, Clone)]
pub struct ManipulabilitySample {
    pub position: thalos_math::Vector3,
    pub yoshikawa: f64,
    pub isotropy: f64,
}
