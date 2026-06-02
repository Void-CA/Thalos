/// Estado de convergencia del solver de cinemática inversa.
#[derive(Debug, Clone, PartialEq)]
pub enum IKStatus {
    /// El error final está por debajo de la tolerancia.
    Converged,
    /// Se alcanzó el máximo de iteraciones sin converger.
    MaxIterations,
}

impl IKStatus {
    pub fn is_converged(&self) -> bool {
        matches!(self, IKStatus::Converged)
    }
}

/// Resultado completo de una ejecución de cinemática inversa.
///
/// Contiene no solo la solución `q` sino también metadatos que permiten
/// comparar algoritmos distintos (Jacobian Transpose vs DLS vs CCD, etc.)
/// sin cambiar nada del código consumidor.
#[derive(Debug, Clone)]
pub struct IKResult {
    /// Configuración articular final (solución, o mejor aproximación).
    pub q: Vec<f64>,
    /// Estado de convergencia.
    pub status: IKStatus,
    /// Número de iteraciones realizadas.
    pub iterations: usize,
    /// Norma del error al finalizar (`‖target − FK(q)‖`).
    pub final_error: f64,
    /// Historial opcional del error por iteración.
    pub error_history: Option<Vec<f64>>,
}

impl IKResult {
    /// Construye un resultado con estado `Converged`.
    pub fn converged(
        q: Vec<f64>,
        iterations: usize,
        final_error: f64,
        error_history: Option<Vec<f64>>,
    ) -> Self {
        Self {
            q,
            status: IKStatus::Converged,
            iterations,
            final_error,
            error_history,
        }
    }

    /// Construye un resultado con estado `MaxIterations`.
    pub fn max_iterations(
        q: Vec<f64>,
        iterations: usize,
        final_error: f64,
        error_history: Option<Vec<f64>>,
    ) -> Self {
        Self {
            q,
            status: IKStatus::MaxIterations,
            iterations,
            final_error,
            error_history,
        }
    }
}
