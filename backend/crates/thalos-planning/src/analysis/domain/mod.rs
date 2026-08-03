//! Modelo de dominio del análisis de trayectorias.
//!
//! Define los tipos, contratos e invariantes que M8.1, M8.2 y M8.3
//! implementarán. Este módulo NO contiene algoritmos — solo el modelo.
//!
//! # Knowledge Hierarchy
//!
//! Los siguientes tipos organizan el conocimiento del sistema. Están
//! definidos como structs vacíos en M8.0; las implementaciones aparecen
//! en milestones posteriores.
//!
//! - `RobotKnowledge`: geometría y cinemática del robot (permanente)
//! - `PlanningKnowledge`: alcanzabilidad, manipulabilidad (entorno)
//! - `TrajectoryKnowledge`: regiones, score, estadísticas (por plan)
//! - `RepairKnowledge`: candidatos, delta, historial (efímero)

pub mod explain;
pub mod metrics;
pub mod traits;
pub mod types;

pub use explain::RegionExplanation;
pub use metrics::{RegionBoundary, RegionMetrics};
pub use traits::{RepairCapability, StrategyKind};
pub use types::{ProblemRegion, RegionEvidence, RegionId, RegionKind, RegionSeverity};

// Los tipos de knowledge han migrado a `crate::knowledge::domain` (M8.3).
