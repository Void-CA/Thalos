use serde::{Deserialize, Serialize};
use crate::utils::clean;

pub type VisualId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualScene {
    pub frames: Vec<VisualFrame>,
    pub links: Vec<VisualLink>,
    pub joint_axes: Vec<VisualJointAxis>,
    pub twists: Vec<VisualTwist>,
}

impl VisualScene {
    pub fn normalized(mut self) -> Self {
        for frame in &mut self.frames {
            frame.translation = frame.translation.map(clean);
            frame.rotation = frame.rotation.map(clean);
        }

        for link in &mut self.links {
            link.start = link.start.map(clean);
            link.end = link.end.map(clean);
        }

        for axis in &mut self.joint_axes {
            axis.origin = axis.origin.map(clean);
            axis.axis = axis.axis.map(clean);
        }

        self
    }
}

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


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualLink {
    /// Origen del link en coordenadas globales: `[x, y, z]`.
    pub start: [f64; 3],
    /// Extremo del link en coordenadas globales: `[x, y, z]`.
    pub end: [f64; 3],
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualJointAxis {
    /// Origen del eje en coordenadas globales: `[x, y, z]`.
    pub origin: [f64; 3],
    /// Dirección del eje (vector unitario) en coordenadas globales: `[x, y, z]`.
    pub axis: [f64; 3],
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualTwist {
    /// Punto de aplicación del twist en coordenadas globales: `[x, y, z]`.
    pub origin: [f64; 3],
    /// Componente lineal del twist: `[vx, vy, vz]`.
    pub linear: [f64; 3],
    /// Componente angular del twist: `[ωx, ωy, ωz]`.
    pub angular: [f64; 3],
}
