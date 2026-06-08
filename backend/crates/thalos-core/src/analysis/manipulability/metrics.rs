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
}
