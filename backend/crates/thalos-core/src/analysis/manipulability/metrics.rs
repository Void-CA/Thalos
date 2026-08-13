/// Aggregated manipulability statistics over a workspace.
#[derive(Debug, Clone, Copy)]
pub struct ManipulabilityMetrics {
    pub total_samples: usize,
    pub avg_yoshikawa: f64,
    pub min_yoshikawa: f64,
    pub max_yoshikawa: f64,
    pub avg_isotropy: f64,
    pub min_isotropy: f64,
    pub max_isotropy: f64,
    /// Chain-side canonical robot-scale normalization factor (`L_ref`,
    /// meters) — the reference dimension the normalized measure was
    /// computed against (spec analysis-report-contract "Additive Reference
    /// Dimension on Metrics").
    pub reference_dimension: f64,
}
