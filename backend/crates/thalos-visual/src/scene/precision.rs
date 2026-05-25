/// Política de canonicalización numérica para la escena visual.
///
/// SceneBuilder aplica esta política **antes de emitir el DTO**,
/// no en tests ni en el frontend. Esto garantiza que la representación
/// visual sea estable, determinística y libre de ruido numérico
/// (ej: `6.123e-17` en vez de `0.0`).
///
/// # Filosofía
/// Esto NO es "pérdida de precisión". Es **canonicalización** de un DTO
/// espacial/visual cuyo propósito es ser consumido por:
///
/// - Renderers (Three.js, Bevy, WebGPU)
/// - Snapshot tests (insta)
/// - Exporters (JSON, ROS bags)
/// - Debug overlays y tooltips
///
/// El engine matemático interno (thalos-core) retiene precisión completa.
///
/// # Responsabilidad única
/// `VisualPrecision` solo se encarga de **limpiar ruido numérico**.
/// La **preservación de invariantes matemáticas** (ej: cuaternión unitario)
/// es responsabilidad de SceneBuilder (capa Normalizer).
pub struct VisualPrecision {
    /// Valores con `|x| < epsilon_zero` se redondean a `0.0`.
    pub epsilon_zero: f64,
    /// Cantidad de decimales para redondeo.
    pub decimal_places: usize,
}

impl Default for VisualPrecision {
    fn default() -> Self {
        Self {
            epsilon_zero: 1e-10,
            decimal_places: 6,
        }
    }
}

impl VisualPrecision {
    /// Normaliza un solo valor `f64` según esta política.
    pub fn normalize(&self, val: f64) -> f64 {
        if val.abs() < self.epsilon_zero {
            0.0
        } else {
            let factor = 10_f64.powi(self.decimal_places as i32);
            (val * factor).round() / factor
        }
    }

    /// Normaliza un array de 3 elementos in-place.
    pub fn normalize_3(&self, arr: &mut [f64; 3]) {
        for v in arr.iter_mut() {
            *v = self.normalize(*v);
        }
    }

    /// Normaliza un array de 4 elementos in-place.
    pub fn normalize_4(&self, arr: &mut [f64; 4]) {
        for v in arr.iter_mut() {
            *v = self.normalize(*v);
        }
    }
}
