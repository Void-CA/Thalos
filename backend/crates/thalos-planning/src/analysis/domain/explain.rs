/// Explicación legible de una región problemática.
#[derive(Debug, Clone)]
pub struct RegionExplanation {
    /// Causa raíz del problema en lenguaje natural.
    pub cause: String,
    /// Consecuencias e impacto.
    pub consequence: String,
    /// Estrategias de reparación sugeridas (strings, no tipos del dominio).
    pub recommended_strategies: Vec<String>,
}
