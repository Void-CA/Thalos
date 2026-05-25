

pub mod precision;
pub mod diff;

use serde::{Deserialize, Serialize};

pub use precision::VisualPrecision;
pub use diff::{SceneDiff, ChangedFrame};

// ─── VisualId ─────────────────────────────────────────────────────

/// Identificador serializable y legible para elementos de la escena visual.
///
/// Es una `String` human-readable como `"world"`, `"link_1"`, o `"ee"`.
/// A diferencia de [`FrameId`](thalos_core::spatial::frame::FrameId) (enum
/// interno del core), `VisualId` es estable, serializable, y no filtra
/// detalles de implementación del core hacia el frontend.
///
/// # Invariante
/// - `"world"` es el único ID reservado para el frame raíz.
/// - Todos los demás IDs provienen del `FrameRegistry` del robot.
/// - No existen IDs sintéticos ni auto-generados sin namespace.
pub type VisualId = String;

// ─── Scene ────────────────────────────────────────────────────────

/// Escena visual técnica, portable, serializable y determinística.
///
/// Ver la [documentación del módulo](self) para el contrato completo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualScene {
    /// Frames de referencia en orden topológico (world primero).
    pub frames: Vec<VisualFrame>,
    /// Links rígidos entre frames (derivables de `frames`).
    pub links: Vec<VisualLink>,
    /// Ejes articulares en coordenadas globales.
    pub joint_axes: Vec<VisualJointAxis>,
    /// Twists (columnas del Jacobiano geométrico).
    pub twists: Vec<VisualTwist>,
}

// ─── Frame ────────────────────────────────────────────────────────

/// Un frame de referencia (sistema de coordenadas) en la escena.
///
/// Cada frame tiene un `parent` opcional que preserva el árbol
/// cinemático. El frame `"world"` tiene `parent: None`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualFrame {
    /// Identificador único y legible (ej: `"world"`, `"link_1"`).
    pub id: VisualId,
    /// ID del frame padre. `None` solo para `"world"`.
    pub parent: Option<VisualId>,
    /// Traslación en coordenadas globales: `[x, y, z]`.
    pub translation: [f64; 3],
    /// Rotación como cuaternión unitario: `[w, x, y, z]` (scalar-first).
    pub rotation: [f64; 4],
}

// ─── Link ─────────────────────────────────────────────────────────

/// Segmento rígido entre dos frames — la representación visual del link.
///
/// `start` y `end` están en coordenadas globales.
///
/// # NOTA
/// Los links son **derivables** de [`VisualScene.frames`](VisualScene):
/// - `start = parent.translation`
/// - `end = child.translation`
///
/// Se incluyen explícitamente para conveniencia del renderer directo.
/// Ver la [decisión arquitectónica](self#decisión-arquitectónica-links-explícitos)
/// para más contexto.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualLink {
    /// Origen del link en coordenadas globales: `[x, y, z]`.
    pub start: [f64; 3],
    /// Extremo del link en coordenadas globales: `[x, y, z]`.
    pub end: [f64; 3],
}

// ─── Joint Axis ───────────────────────────────────────────────────

/// Eje de articulación expresado en coordenadas globales.
///
/// Fundamental para debugging cinemático: permite validar visualmente
/// que los ejes articulares apuntan en la dirección correcta y que
/// están posicionados en el origen correcto.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualJointAxis {
    /// Origen del eje en coordenadas globales: `[x, y, z]`.
    pub origin: [f64; 3],
    /// Dirección del eje (vector unitario) en coordenadas globales: `[x, y, z]`.
    pub axis: [f64; 3],
}

// ─── Twist ────────────────────────────────────────────────────────

/// Twist espacial: velocidad lineal + angular expresada en un punto.
///
/// Cada columna del Jacobiano geométrico es un twist:
///
/// ```text
/// ξ = [ v ]   (linear:  velocidad lineal en el origen)
///     [ ω ]   (angular: velocidad angular)
/// ```
///
/// El `origin` es el punto donde está aplicado el twist (típicamente
/// el origen del joint correspondiente en coordenadas globales).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualTwist {
    /// Punto de aplicación del twist en coordenadas globales: `[x, y, z]`.
    pub origin: [f64; 3],
    /// Componente lineal del twist: `[vx, vy, vz]`.
    pub linear: [f64; 3],
    /// Componente angular del twist: `[ωx, ωy, ωz]`.
    pub angular: [f64; 3],
}
