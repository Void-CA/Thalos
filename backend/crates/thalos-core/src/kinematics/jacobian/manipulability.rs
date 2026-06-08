use super::singularity::SingularityReport;

/// Manipulability metrics derived from the singular values of a Jacobian.
///
/// Zero-cost derivation from [`SingularityReport`] — no additional SVD needed.
/// The singular values are already computed; this just interprets them.
#[derive(Debug, Clone, Copy)]
pub struct ManipulabilityReport {
    /// Yoshikawa manipulability measure: `w = ∏ σᵢ`.
    ///
    /// Product of all significant singular values. Zero when the Jacobian
    /// is rank-deficient (singular). Higher = more dexterous.
    pub yoshikawa: f64,

    /// Isotropy ratio: `σ_min / σ_max` in range [0, 1].
    ///
    /// - 1.0 = perfectly isotropic (equal dexterity in all directions)
    /// - 0.0 = degenerate (at least one direction has zero manipulability)
    pub isotropy: f64,
}

impl ManipulabilityReport {
    /// Derive manipulability from an already-computed [`SingularityReport`].
    ///
    /// This is O(n) in the number of singular values — essentially free
    /// after the SVD in `SingularityReport::analyze`.
    pub fn compute(singularity: &SingularityReport) -> Self {
        let yoshikawa: f64 = singularity.singular_values.iter().product();

        let max_sv = singularity
            .singular_values
            .first()
            .copied()
            .unwrap_or(0.0);
        let min_sv = singularity
            .singular_values
            .last()
            .copied()
            .unwrap_or(0.0);

        let isotropy = if max_sv > 0.0 {
            min_sv / max_sv
        } else {
            0.0
        };

        Self {
            yoshikawa,
            isotropy,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinematics::jacobian::SingularityReport;

    fn make_singularity(sv: Vec<f64>, rank: usize, cond: f64) -> SingularityReport {
        let det_jtj: f64 = sv.iter().map(|s| s * s).product();
        SingularityReport {
            det_jtj,
            condition_number: cond,
            rank,
            singular_values: sv,
        }
    }

    #[test]
    fn isotropic_yoshikawa_product() {
        // σ = [3, 3, 3] → w = 27, isotropy = 1.0
        let sr = make_singularity(vec![3.0, 3.0, 3.0], 3, 1.0);
        let m = ManipulabilityReport::compute(&sr);
        assert!((m.yoshikawa - 27.0).abs() < 1e-12);
        assert!((m.isotropy - 1.0).abs() < 1e-12);
    }

    #[test]
    fn anisotropic() {
        // σ = [5, 1] → w = 5, isotropy = 0.2
        let sr = make_singularity(vec![5.0, 1.0], 2, 5.0);
        let m = ManipulabilityReport::compute(&sr);
        assert!((m.yoshikawa - 5.0).abs() < 1e-12);
        assert!((m.isotropy - 0.2).abs() < 1e-12);
    }

    #[test]
    fn rank_deficient_zero_manipulability() {
        // σ = [2, 0] → w = 0, isotropy = 0
        let sr = make_singularity(vec![2.0, 0.0], 1, f64::INFINITY);
        let m = ManipulabilityReport::compute(&sr);
        assert!((m.yoshikawa - 0.0).abs() < 1e-12);
        assert!((m.isotropy - 0.0).abs() < 1e-12);
    }

    #[test]
    fn empty_singular_values() {
        let sr = make_singularity(vec![], 0, f64::INFINITY);
        let m = ManipulabilityReport::compute(&sr);
        assert!((m.yoshikawa - 1.0).abs() < 1e-12); // empty product = 1
        assert!((m.isotropy - 0.0).abs() < 1e-12);
    }
}
