/// Identificador único de una región problemática dentro de un análisis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RegionId(pub usize);

/// Clasificación de la naturaleza de una región problemática.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RegionKind {
    Singularity,
    LowManipulability,
    Collision,
    Tracking,
    Velocity,
    Constraint,
}

impl RegionKind {
    pub fn name(&self) -> &'static str {
        match self {
            RegionKind::Singularity => "singularity",
            RegionKind::LowManipulability => "low_manipulability",
            RegionKind::Collision => "collision",
            RegionKind::Tracking => "tracking",
            RegionKind::Velocity => "velocity",
            RegionKind::Constraint => "constraint",
        }
    }
}

/// Severidad agregada de una región, derivada de la máxima severidad entre sus findings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RegionSeverity {
    Info,
    Warning,
    Critical,
}

/// Evidencia de conocimiento para una región problemática.
#[derive(Debug, Clone)]
pub struct RegionEvidence {
    pub source: String,
    pub reason: String,
    pub weight: f64,
}

/// Una región problemática semántica — rango contiguo de waypoints con la misma causa raíz.
///
/// # Invariantes
/// - `waypoint_range` contiene al menos un waypoint
/// - Los waypoints son contiguos (sin huecos)
/// - Todos los findings comparten el mismo `kind`
/// - `severity` refleja la máxima severidad entre todos los findings de la región
#[derive(Debug, Clone)]
pub struct ProblemRegion {
    pub id: RegionId,
    pub kind: RegionKind,
    pub severity: RegionSeverity,
    pub waypoint_range: std::ops::Range<usize>,
    pub metrics: Option<super::metrics::RegionMetrics>,
    pub boundary: Option<super::metrics::RegionBoundary>,
    pub explanation: Option<super::explain::RegionExplanation>,
    /// Confianza en la detección (0.0..1.0). Inicialmente 1.0.
    /// El conocimiento puede ajustarla.
    pub confidence: f64,
    /// Evidencia estructurada del conocimiento que respalda la región.
    pub evidence: Vec<RegionEvidence>,
}

impl ProblemRegion {
    /// Crea una nueva región validando invariantes básicos.
    ///
    /// # Panics
    /// En debug, si el rango está vacío o no es contiguo.
    pub fn new(
        id: RegionId,
        kind: RegionKind,
        severity: RegionSeverity,
        waypoint_range: std::ops::Range<usize>,
    ) -> Self {
        debug_assert!(
            !waypoint_range.is_empty(),
            "ProblemRegion must contain at least one waypoint"
        );
        debug_assert!(
            waypoint_range.start <= waypoint_range.end,
            "ProblemRegion waypoint_range must be ordered"
        );
        Self {
            id,
            kind,
            severity,
            waypoint_range,
            metrics: None,
            boundary: None,
            explanation: None,
            confidence: 1.0,
            evidence: vec![],
        }
    }

    pub fn waypoint_count(&self) -> usize {
        self.waypoint_range.len()
    }
}
