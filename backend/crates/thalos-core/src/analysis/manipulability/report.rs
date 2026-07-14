use crate::kinematics::jacobian::{ManipulabilityReport, SingularityReport};
use thalos_math::Vector3;

use super::metrics::ManipulabilityMetrics;

/// One workspace sample with its derived manipulability metrics.
#[derive(Debug, Clone)]
pub struct ManipulabilitySample {
    pub q: Vec<f64>,
    pub position: Vector3,
    pub singularity: SingularityReport,
    pub manipulability: ManipulabilityReport,
}

/// Aggregated result of a workspace manipulability analysis.
#[derive(Debug, Clone)]
pub struct ManipulabilityAnalysis {
    pub samples: Vec<ManipulabilitySample>,
    pub metrics: ManipulabilityMetrics,
}

fn aggregate(samples: &[ManipulabilitySample]) -> ManipulabilityMetrics {
    let total = samples.len();
    let mut sum_y = 0.0_f64;
    let mut min_y = f64::MAX;
    let mut max_y = 0.0_f64;
    let mut sum_i = 0.0_f64;
    let mut min_i = f64::MAX;
    let mut max_i = 0.0_f64;

    for s in samples {
        let y = s.manipulability.yoshikawa;
        let i = s.manipulability.isotropy;
        sum_y += y;
        if y < min_y {
            min_y = y;
        }
        if y > max_y {
            max_y = y;
        }
        sum_i += i;
        if i < min_i {
            min_i = i;
        }
        if i > max_i {
            max_i = i;
        }
    }

    ManipulabilityMetrics {
        total_samples: total,
        avg_yoshikawa: if total > 0 { sum_y / total as f64 } else { 0.0 },
        min_yoshikawa: if min_y == f64::MAX { 0.0 } else { min_y },
        max_yoshikawa: max_y,
        avg_isotropy: if total > 0 { sum_i / total as f64 } else { 0.0 },
        min_isotropy: if min_i == f64::MAX { 0.0 } else { min_i },
        max_isotropy: max_i,
    }
}

impl ManipulabilityAnalysis {
    pub fn from_samples(samples: Vec<ManipulabilitySample>) -> Self {
        let metrics = aggregate(&samples);
        Self { samples, metrics }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinematics::jacobian::SingularityReport;

    fn sample(yoshikawa: f64, isotropy: f64) -> ManipulabilitySample {
        ManipulabilitySample {
            q: vec![],
            position: Vector3::new(0.0, 0.0, 0.0),
            singularity: SingularityReport {
                det_jtj: 0.0,
                condition_number: 1.0,
                rank: 1,
                singular_values: vec![],
            },
            manipulability: ManipulabilityReport { yoshikawa, isotropy },
        }
    }

    #[test]
    fn aggregate_single() {
        let a = ManipulabilityAnalysis::from_samples(vec![sample(10.0, 0.5)]);
        assert_eq!(a.metrics.total_samples, 1);
        assert!((a.metrics.avg_yoshikawa - 10.0).abs() < 1e-12);
        assert!((a.metrics.avg_isotropy - 0.5).abs() < 1e-12);
    }

    #[test]
    fn aggregate_multiple() {
        let samples = vec![sample(10.0, 0.9), sample(2.0, 0.1), sample(6.0, 0.5)];
        let a = ManipulabilityAnalysis::from_samples(samples);
        assert_eq!(a.metrics.total_samples, 3);
        assert!((a.metrics.avg_yoshikawa - 6.0).abs() < 1e-12);
        assert!((a.metrics.min_yoshikawa - 2.0).abs() < 1e-12);
        assert!((a.metrics.max_yoshikawa - 10.0).abs() < 1e-12);
        assert!((a.metrics.avg_isotropy - 0.5).abs() < 1e-12);
        assert!((a.metrics.min_isotropy - 0.1).abs() < 1e-12);
        assert!((a.metrics.max_isotropy - 0.9).abs() < 1e-12);
    }
}
