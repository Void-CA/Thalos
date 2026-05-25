use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::scene::{VisualFrame, VisualId, VisualScene};

// ─── SceneDiff ────────────────────────────────────────────────────

/// Resultado de comparar dos escenas visuales.
///
/// Permite detectar qué cambió entre dos estados cinemáticos sin
/// comparar la totalidad de las escenas.
///
/// # Dirección
/// `SceneDiff::between(&old, &new, eps)` reporta:
/// - `frames_removed`: estaban en `old`, ya no en `new` (orden de `old`)
/// - `frames_added`: no estaban en `old`, aparecen en `new` (orden de `new`)  
/// - `changed_frames`: en ambos, pero cambiaron (orden de `old`)
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SceneDiff {
    pub frames_removed: Vec<VisualId>,
    pub frames_added: Vec<VisualId>,
    pub changed_frames: Vec<ChangedFrame>,
}

impl SceneDiff {
    /// Calcula el diff entre dos escenas.
    ///
    /// `epsilon` es la distancia/ángulo mínimo para considerar que un
    /// frame cambió. Valores típicos: `1e-6` para snapshots estrictos,
    /// `1e-3` para tolerancia visual.
    pub fn between(old: &VisualScene, new: &VisualScene, epsilon: f64) -> Self {
        let new_by_id: HashMap<&str, &VisualFrame> =
            new.frames.iter().map(|f| (f.id.as_str(), f)).collect();

        let old_by_id: HashMap<&str, &VisualFrame> =
            old.frames.iter().map(|f| (f.id.as_str(), f)).collect();

        let mut diff = SceneDiff::default();

        // Frames removidos (en old pero no en new)
        for frame in &old.frames {
            if !new_by_id.contains_key(frame.id.as_str()) {
                diff.frames_removed.push(frame.id.clone());
            }
        }

        // Frames agregados (en new pero no en old)
        for frame in &new.frames {
            if !old_by_id.contains_key(frame.id.as_str()) {
                diff.frames_added.push(frame.id.clone());
            }
        }

        // Frames modificados (en ambos)
        // Itera sobre old.frames para mantener el orden topológico
        for frame in &old.frames {
            if let Some(new_frame) = new_by_id.get(frame.id.as_str()) {
                let tx_dist = translation_distance(&frame.translation, &new_frame.translation);
                let rot_angle = geodesic_rotation_deg(&frame.rotation, &new_frame.rotation);

                if tx_dist > epsilon || rot_angle > epsilon {
                    diff.changed_frames.push(ChangedFrame {
                        id: frame.id.clone(),
                        translation_delta: round_to(tx_dist, 6),
                        rotation_angle_deg: round_to(rot_angle, 4),
                    });
                }
            }
        }

        diff
    }
}

// ─── ChangedFrame ─────────────────────────────────────────────────

/// Descripción del cambio en un frame individual.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangedFrame {
    pub id: VisualId,
    /// Distancia euclídea entre la posición anterior y la nueva.
    pub translation_delta: f64,
    /// Ángulo de rotación geodésico en SO(3) en grados (0..180).
    pub rotation_angle_deg: f64,
}

// ─── Helpers ──────────────────────────────────────────────────────

fn translation_distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Distancia geodésica en **SO(3)** entre dos rotaciones, en grados (0..180).
///
/// Fórmula correcta para cuaterniones NO necesariamente unitarios:
///
/// ```text
/// cos(θ/2) = |q₁·q₂| / (‖q₁‖ · ‖q₂‖)
/// ```
///
/// donde `|q₁·q₂|` usa valor absoluto para manejar la ambigüedad
/// `q` vs `-q` (ambos representan la misma rotación en SO(3)).
///
/// # Garantías
/// - `q₁ == q₂` → `θ = 0°` (incluso si no son exactamente unitarios).
/// - `q₁ = -q₂` → `θ = 0°` (misma rotación, signo opuesto).
/// - Rango: `[0°, 180°]`.
fn geodesic_rotation_deg(a: &[f64; 4], b: &[f64; 4]) -> f64 {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

    // Producto de normas para normalizar el dot product
    let norm_a = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]).sqrt();
    let norm_b = (b[0] * b[0] + b[1] * b[1] + b[2] * b[2] + b[3] * b[3]).sqrt();
    let denominator = norm_a * norm_b;

    if denominator < 1e-15 {
        return 0.0;
    }

    // |dot|/denom maneja la ambigüedad q vs -q:
    // Si q₂ = -q₁, dot = -‖q₁‖² → |dot|/denom = 1 → θ = 0
    let cos_half = (dot / denominator).abs().clamp(-1.0, 1.0);
    (2.0 * cos_half.acos()).to_degrees()
}

fn round_to(val: f64, places: usize) -> f64 {
    let factor = 10_f64.powi(places as i32);
    (val * factor).round() / factor
}
