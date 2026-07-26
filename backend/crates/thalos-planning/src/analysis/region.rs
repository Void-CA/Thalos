//! Detección de regiones problemáticas a partir de findings atómicos.
//!
//! El `RegionDetector` implementa una tubería de 3 etapas:
//!
//! 1. **normalize**: ordena y deduplica findings por waypoint
//! 2. **detect_regions**: agrupa findings contiguos del mismo kind en regiones
//! 3. **score**: computa métricas por región y health score global
//!
//! El pipeline es DETERMINISTA: misma entrada → mismas regiones.

use crate::analysis::domain::{
    metrics::RegionMetrics, types::*, ProblemRegion, RegionEvidence, RegionExplanation,
    RegionId, RegionKind, RegionSeverity,
};
use crate::knowledge::provider::PlanningKnowledgeProvider;
use crate::analysis::AnalysisReport;
use crate::finding::{Finding, FindingKind};

// ─── Config ──────────────────────────────────────────────────────────

/// Configuración del detector de regiones.
#[derive(Debug, Clone)]
pub struct RegionDetectorConfig {
    /// Distancia máxima entre waypoints para considerarlos parte de la misma región.
    /// Default: 2 (un waypoint sano entre dos problemáticos no separa).
    pub gap_threshold: usize,
    /// Cantidad mínima de waypoints para formar una región.
    /// Default: 1.
    pub minimum_region_size: usize,
    /// Si es true, los findings aislados (singletons) no forman región.
    /// Default: false.
    pub ignore_singletons: bool,
}

impl Default for RegionDetectorConfig {
    fn default() -> Self {
        Self {
            gap_threshold: 2,
            minimum_region_size: 1,
            ignore_singletons: false,
        }
    }
}

// ─── Health Score ────────────────────────────────────────────────────

/// Estrategia de cómputo del health score.
pub trait HealthScoringStrategy {
    /// Calcula el health score (0.0 = peor, 1.0 = mejor) a partir de las regiones.
    fn score(&self, regions: &[ProblemRegion]) -> f64;
}

/// Estrategia por defecto: cada región crítica penaliza -0.3, cada warning -0.1.
/// Máxima penalización: 1.0.
#[derive(Default)]
pub struct DefaultHealthScoring;

impl HealthScoringStrategy for DefaultHealthScoring {
    fn score(&self, regions: &[ProblemRegion]) -> f64 {
        let mut penalty = 0.0_f64;
        for r in regions {
            match r.severity {
                RegionSeverity::Critical => penalty += 0.3,
                RegionSeverity::Warning => penalty += 0.1,
                RegionSeverity::Info => {}
            }
        }
        (1.0 - penalty.min(1.0)).max(0.0)
    }
}

// ─── Region Detector ─────────────────────────────────────────────────

/// Detector de regiones problemáticas.
///
/// Pipeline: normalize → detect_regions → score.
///
/// # Determinismo
///
/// El pipeline usa solo `Vec` ordenado y estructuras deterministas.
/// Misma entrada → mismo `AnalysisReport` siempre.
pub struct RegionDetector {
    config: RegionDetectorConfig,
    health_strategy: Box<dyn HealthScoringStrategy>,
}

impl RegionDetector {
    pub fn new(config: RegionDetectorConfig) -> Self {
        Self {
            config,
            health_strategy: Box::new(DefaultHealthScoring),
        }
    }

    pub fn with_health_strategy(
        config: RegionDetectorConfig,
        strategy: Box<dyn HealthScoringStrategy>,
    ) -> Self {
        Self {
            config,
            health_strategy: strategy,
        }
    }

    /// Ejecuta el pipeline completo de detección.
    pub fn detect(&self, findings: &[Finding]) -> AnalysisReport {
        let normalized = self.normalize(findings);
        let regions = self.detect_regions(&normalized);
        let health_score = self.health_strategy.score(&regions);
        AnalysisReport {
            findings: findings.to_vec(),
            problem_regions: regions,
            health_score,
        }
    }

    /// Detecta regiones y las enriquece con conocimiento del workspace.
    ///
    /// El conocimiento es opcional. Si no se provee, el comportamiento
    /// es idéntico a `detect()`.
    pub fn detect_with_knowledge(
        &self,
        findings: &[Finding],
        knowledge: Option<&dyn PlanningKnowledgeProvider>,
    ) -> AnalysisReport {
        let mut report = self.detect(findings);
        if let Some(kp) = knowledge {
            for region in &mut report.problem_regions {
                self.enrich_region(region, kp);
            }
        }
        report
    }

    /// Enriquece una región con evidencia del conocimiento.
    /// No modifica los límites de la región — solo su confianza y evidencia.
    fn enrich_region(&self, region: &mut ProblemRegion, knowledge: &dyn PlanningKnowledgeProvider) {
        // Consultar singularidad cercana
        let mid_wp = (region.waypoint_range.start + region.waypoint_range.end) / 2;
        let mid_joints = vec![mid_wp as f64; region.waypoint_range.len()]; // placeholder

        if let Some(zone) = knowledge.nearby_singularity(&mid_joints) {
            region.evidence.push(RegionEvidence {
                source: "PlanningKnowledge".to_string(),
                reason: format!(
                    "Inside known singularity zone {} (severity: {:?})",
                    zone.id, zone.severity
                ),
                weight: 0.25,
            });
            region.confidence = (region.confidence + 0.1).min(1.0);
        }

        // Consultar manipulabilidad
        if knowledge.manipulability_at(&mid_joints).map_or(false, |v| v < 0.1) {
            region.evidence.push(RegionEvidence {
                source: "PlanningKnowledge".to_string(),
                reason: "Known low-manipulability region".to_string(),
                weight: 0.15,
            });
        }
    }

    // ─── Etapa 1: Normalize ─────────────────────────────────────────

    /// Ordena findings por waypoint y elimina duplicados (mismo waypoint + mismo kind).
    fn normalize(&self, findings: &[Finding]) -> Vec<NormalizedFinding> {
        let mut sorted: Vec<NormalizedFinding> = findings
            .iter()
            .filter_map(|f| f.waypoint.map(|wp| NormalizedFinding {
                waypoint: wp,
                kind: f.kind,
                severity: f.severity,
                value: f.value,
            }))
            .collect();

        sorted.sort_by(|a, b| a.waypoint.cmp(&b.waypoint));

        sorted
    }

    // ─── Etapa 2: Detect Regions ────────────────────────────────────

    /// Agrupa findings normalizados en regiones.
    /// Dos findings pertenecen a la misma región si:
    /// - Mismo `RegionKind`
    /// - Distancia entre waypoints ≤ `gap_threshold`
    fn detect_regions(&self, normalized: &[NormalizedFinding]) -> Vec<ProblemRegion> {
        if normalized.is_empty() {
            return vec![];
        }

        let mut regions: Vec<ProblemRegion> = Vec::new();
        let mut current_start = normalized[0].waypoint;
        let mut current_end = normalized[0].waypoint + 1;
        let mut current_kind = normalized[0].kind;
        let mut current_findings: Vec<&NormalizedFinding> = Vec::new();
        current_findings.push(&normalized[0]);

        for finding in &normalized[1..] {
            let same_kind = finding.kind == current_kind;
            let distance = finding.waypoint.saturating_sub(current_end.saturating_sub(1));

            if same_kind && distance <= self.config.gap_threshold {
                // Extender región actual
                current_end = current_end.max(finding.waypoint + 1);
                current_findings.push(finding);
            } else {
                // Cerrar región actual
                if self.should_keep_region(&current_findings) {
                    regions.push(self.build_region(
                        regions.len(),
                        current_kind,
                        current_start..current_end,
                        &current_findings,
                    ));
                }
                // Iniciar nueva región
                current_start = finding.waypoint;
                current_end = finding.waypoint + 1;
                current_kind = finding.kind;
                current_findings.clear();
                current_findings.push(finding);
            }
        }

        // Cerrar última región
        if self.should_keep_region(&current_findings) {
            regions.push(self.build_region(
                regions.len(),
                current_kind,
                current_start..current_end,
                &current_findings,
            ));
        }

        regions
    }

    fn should_keep_region(&self, findings: &[&NormalizedFinding]) -> bool {
        if self.config.ignore_singletons && findings.len() < self.config.minimum_region_size {
            return false;
        }
        findings.len() >= self.config.minimum_region_size
    }

    fn build_region(
        &self,
        id: usize,
        kind: FindingKind,
        range: std::ops::Range<usize>,
        findings: &[&NormalizedFinding],
    ) -> ProblemRegion {
        let region_kind = Self::kind_from_finding(kind);
        let severity = Self::compute_severity(findings);

        let mut metrics = RegionMetrics {
            waypoint_count: range.len(),
            average_value: None,
            min_value: None,
            max_value: None,
            error_count: 0,
            warning_count: 0,
        };

        let mut sum = 0.0_f64;
        let mut value_count = 0_usize;

        for f in findings {
            match f.severity {
                crate::finding::Severity::Error => metrics.error_count += 1,
                crate::finding::Severity::Warning => metrics.warning_count += 1,
                crate::finding::Severity::Info => {}
            }
            if let Some(val) = f.value {
                sum += val;
                value_count += 1;
                let v = val;
                metrics.min_value = Some(metrics.min_value.map_or(v, |m| m.min(v)));
                metrics.max_value = Some(metrics.max_value.map_or(v, |m| m.max(v)));
            }
        }

        if value_count > 0 {
            metrics.average_value = Some(sum / value_count as f64);
        }

        let strategies = match region_kind {
            RegionKind::Collision => vec!["Lift TCP".into(), "Insert waypoint".into(), "Adjust approach angle".into()],
            RegionKind::Singularity => vec!["Switch IK solver".into(), "Lift TCP".into(), "Adjust path".into()],
            RegionKind::LowManipulability => vec!["Switch IK solver".into(), "Lift TCP".into(), "Insert waypoint".into()],
            RegionKind::Constraint => vec!["Adjust joint range".into(), "Insert intermediate waypoint".into()],
            RegionKind::Velocity => vec!["Reduce speed".into(), "Adjust acceleration profile".into()],
            RegionKind::Tracking => vec!["Increase sample rate".into(), "Adjust tracking parameters".into()],
        };

        let explanation = RegionExplanation {
            cause: format!("{} region detected at waypoints {}–{}", region_kind.name(), range.start, range.end.saturating_sub(1)),
            consequence: format!("{} findings, {} errors, {} warnings", metrics.waypoint_count, metrics.error_count, metrics.warning_count),
            recommended_strategies: strategies,
            confidence: 1.0,
        };

        ProblemRegion {
            id: RegionId(id),
            kind: region_kind,
            severity,
            waypoint_range: range,
            metrics: Some(metrics),
            boundary: None,
            explanation: Some(explanation),
            confidence: 1.0,
            evidence: vec![],
        }
    }

    fn kind_from_finding(kind: FindingKind) -> RegionKind {
        match kind {
            FindingKind::Collision | FindingKind::CollisionNear => RegionKind::Collision,
            FindingKind::Singularity => RegionKind::Singularity,
            FindingKind::NearSingularity => RegionKind::Singularity, // near-singular es una singularidad incipiente
            FindingKind::LowManipulability | FindingKind::IkSuggestion => RegionKind::LowManipulability,
            FindingKind::TrackingError
            | FindingKind::TrackingSpike
            | FindingKind::JointDeviation => RegionKind::Tracking,
            FindingKind::VelocityDeviation => RegionKind::Velocity,
            FindingKind::ConstraintViolation => RegionKind::Constraint,
        }
    }

    fn compute_severity(findings: &[&NormalizedFinding]) -> RegionSeverity {
        let mut max = RegionSeverity::Info;
        for f in findings {
            let sev = match f.severity {
                crate::finding::Severity::Error => RegionSeverity::Critical,
                crate::finding::Severity::Warning => RegionSeverity::Warning,
                crate::finding::Severity::Info => RegionSeverity::Info,
            };
            if sev > max {
                max = sev;
            }
        }
        max
    }
}

// ─── Internal types ──────────────────────────────────────────────────

/// Finding normalizado: ordenado y deduplicado.
#[derive(Debug, Clone)]
struct NormalizedFinding {
    waypoint: usize,
    kind: FindingKind,
    severity: crate::finding::Severity,
    value: Option<f64>,
}

// ═════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finding::Severity;

    fn make_finding(waypoint: usize, kind: FindingKind, severity: Severity) -> Finding {
        Finding {
            kind,
            severity,
            waypoint: Some(waypoint),
            message: String::new(),
            value: None,
            threshold: None,
        }
    }

    #[test]
    fn test_single_region() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
            make_finding(6, FindingKind::Singularity, Severity::Error),
            make_finding(7, FindingKind::Singularity, Severity::Warning),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 1);
        assert_eq!(report.problem_regions[0].waypoint_range, 5..8);
    }

    #[test]
    fn test_gap_splits_regions() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
            make_finding(6, FindingKind::Singularity, Severity::Error),
            make_finding(10, FindingKind::Singularity, Severity::Warning),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        // gap_threshold=2, waypoints 6→10 distance=4 > 2 → split
        assert_eq!(report.problem_regions.len(), 2);
        assert_eq!(report.problem_regions[0].waypoint_range, 5..7);
        assert_eq!(report.problem_regions[1].waypoint_range, 10..11);
    }

    #[test]
    fn test_different_kinds_never_merge() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
            make_finding(6, FindingKind::LowManipulability, Severity::Warning),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 2);
    }

    #[test]
    fn test_gap_within_threshold_keeps_region() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
            make_finding(7, FindingKind::Singularity, Severity::Error),
        ];
        let mut config = RegionDetectorConfig::default();
        config.gap_threshold = 2; // waypoint 5→7 distance=2 ≤ 2 → misma región
        let detector = RegionDetector::new(config);
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 1);
        assert_eq!(report.problem_regions[0].waypoint_range, 5..8);
    }

    #[test]
    fn test_determinism() {
        let findings = vec![
            make_finding(3, FindingKind::Singularity, Severity::Warning),
            make_finding(1, FindingKind::Singularity, Severity::Error),
            make_finding(2, FindingKind::LowManipulability, Severity::Info),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report1 = detector.detect(&findings);
        let report2 = detector.detect(&findings);
        assert_eq!(report1.problem_regions.len(), report2.problem_regions.len());
        assert_eq!(
            report1.problem_regions[0].waypoint_range,
            report2.problem_regions[0].waypoint_range
        );
    }

    #[test]
    fn test_health_score_perfect() {
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&[]);
        assert!((report.health_score - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_health_score_penalty() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
            make_finding(6, FindingKind::Singularity, Severity::Warning),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert!(report.health_score < 1.0);
        assert!(report.health_score > 0.0);
    }

    #[test]
    fn test_ignore_singletons() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
        ];
        let mut config = RegionDetectorConfig::default();
        config.ignore_singletons = true;
        config.minimum_region_size = 2;
        let detector = RegionDetector::new(config);
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 0);
    }

    #[test]
    fn test_findings_preserved() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert_eq!(report.findings.len(), 1);
    }

    // ─── Real-world validation cases ─────────────────────────────

    #[test]
    fn test_80_contiguous_singularities_one_region() {
        let findings: Vec<Finding> = (147..=226)
            .map(|wp| make_finding(wp, FindingKind::Singularity, Severity::Error))
            .collect();
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 1, "80 singularities → 1 region");
        assert_eq!(report.problem_regions[0].waypoint_count(), 80);
        assert_eq!(report.problem_regions[0].kind, RegionKind::Singularity);
        assert_eq!(report.problem_regions[0].waypoint_range, 147..227);
    }

    #[test]
    fn test_mixed_trajectory_separates_by_kind() {
        let mut findings = Vec::new();
        // 80 singulares contiguos (147-226) → 1 región
        for wp in 147..=226 {
            findings.push(make_finding(wp, FindingKind::Singularity, Severity::Error));
        }
        // 5 colisiones contiguas (401-405) → 1 región
        for wp in 401..=405 {
            findings.push(make_finding(wp, FindingKind::Collision, Severity::Error));
        }
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 2, "1 singular + 1 collision");
        assert_eq!(report.problem_regions[0].kind, RegionKind::Singularity);
        assert_eq!(report.problem_regions[0].waypoint_count(), 80);
        assert_eq!(report.problem_regions[1].kind, RegionKind::Collision);
        assert_eq!(report.problem_regions[1].waypoint_count(), 5);
        // Findings originales preservados
        assert_eq!(report.findings.len(), 85);
    }

    #[test]
    fn test_singularity_and_collision_are_distinct_kinds() {
        let findings = vec![
            make_finding(5, FindingKind::Singularity, Severity::Error),
            make_finding(6, FindingKind::Collision, Severity::Error),
        ];
        let detector = RegionDetector::new(RegionDetectorConfig::default());
        let report = detector.detect(&findings);
        assert_eq!(report.problem_regions.len(), 2);
        assert_eq!(report.problem_regions[0].kind, RegionKind::Singularity);
        assert_eq!(report.problem_regions[1].kind, RegionKind::Collision);
    }
}
