use std::collections::{HashMap, HashSet};

use crate::scene::{VisualFrame, VisualId, VisualScene};

// ─── SceneError ───────────────────────────────────────────────────

/// Errores de validación de la escena visual.
///
/// Cada variante corresponde a una violación del
/// [Visual Scene Contract](crate::scene).
#[derive(Debug, Clone, PartialEq)]
pub enum SceneError {
    /// El frame `"world"` no está presente en la escena.
    MissingWorld,
    /// Un frame referenciado como `parent` no existe en `frames`.
    MissingFrame(VisualId),
    /// El grafo de frames contiene ciclos (viola C1).
    BrokenTopology {
        frame: VisualId,
    },
    /// Valores `NaN` o `Inf` detectados (viola R2).
    NonFiniteValue {
        frame: VisualId,
    },
    /// La norma del cuaternión se desvía de 1 más de lo permitido (viola R1).
    InvalidQuaternion {
        frame: VisualId,
        norm: f64,
    },
    /// Un link no corresponde a ningún par (parent, child) de frames.
    OrphanLink {
        index: usize,
    },
    /// La cantidad de twists no coincide con la cantidad de ejes articulares.
    TwistsMismatch {
        expected: usize,
        found: usize,
    },
    /// ID duplicado entre frames.
    DuplicateId {
        id: VisualId,
    },
}

impl std::fmt::Display for SceneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SceneError::MissingWorld => write!(f, "scene must contain a 'world' frame"),
            SceneError::MissingFrame(id) => {
                write!(f, "parent frame '{}' referenced but not found in scene", id)
            }
            SceneError::BrokenTopology { frame } => {
                write!(f, "cycle detected involving frame '{}'", frame)
            }
            SceneError::NonFiniteValue { frame } => {
                write!(f, "non-finite value detected in frame '{}'", frame)
            }
            SceneError::InvalidQuaternion { frame, norm } => {
                write!(
                    f,
                    "quaternion norm in frame '{}' is {}, expected ~1.0",
                    frame, norm
                )
            }
            SceneError::OrphanLink { index } => {
                write!(f, "link at index {} does not match any parent-child frame pair", index)
            }
            SceneError::TwistsMismatch { expected, found } => {
                write!(
                    f,
                    "twists count {} mismatches joint axes count {}",
                    found, expected
                )
            }
            SceneError::DuplicateId { id } => {
                write!(f, "duplicate frame id '{}'", id)
            }
        }
    }
}

// ─── SceneValidator ───────────────────────────────────────────────

/// Validador runtime del [Visual Scene Contract](crate::scene).
///
/// Verifica que una [`VisualScene`] cumpla con todas las invariantes
/// definidas en el contrato: integridad estructural, consistencia
/// geométrica, canonicalización y alineación entre arrays.
///
/// # Uso
///
/// ```ignore
/// let validator = SceneValidator::default();
/// validator.validate(&scene)?;
/// ```
///
/// # Checks implementados
///
/// | ID  | Check | Método |
/// |-----|-------|--------|
/// | —   | World presente | `check_world_exists` |
/// | —   | IDs únicos | `check_ids_unique` |
/// | —   | Parents existen | `check_parents_exist` |
/// | C1  | Sin ciclos | `check_no_cycles` |
/// | C2  | Conectividad desde world | `check_connectivity` |
/// | R1  | Norma de cuaternión | `check_quaternion_norm` |
/// | R2  | Valores finitos | `check_finite` |
/// | —   | Links consistentes | `check_links_consistency` |
/// | —   | Twists consistentes | `check_twists_consistency` |
pub struct SceneValidator {
    /// Máxima desviación permitida para `|∥q∥ - 1|`.
    pub epsilon_rot: f64,
}

impl Default for SceneValidator {
    fn default() -> Self {
        Self { epsilon_rot: 1e-6 }
    }
}

impl SceneValidator {
    /// Crea un validador con tolerancia personalizada para norma de cuaternión.
    pub fn new(epsilon_rot: f64) -> Self {
        Self { epsilon_rot }
    }

    /// Valida todas las invariantes de la escena.
    ///
    /// Retorna `Ok(())` si la escena cumple el contrato,
    /// o el primer `SceneError` encontrado.
    pub fn validate(&self, scene: &VisualScene) -> Result<(), SceneError> {
        self.check_world_exists(scene)?;
        self.check_ids_unique(scene)?;
        self.check_parents_exist(scene)?;
        self.check_no_cycles(scene)?; // C1
        self.check_connectivity(scene)?; // C2
        self.check_finite(scene)?; // R2
        self.check_quaternion_norm(scene)?; // R1
        self.check_links_consistency(scene)?;
        self.check_twists_consistency(scene)?;
        Ok(())
    }

    // ─── Checks individuales ──────────────────────────────────

    /// Verifica que el frame `"world"` exista en la escena.
    fn check_world_exists(&self, scene: &VisualScene) -> Result<(), SceneError> {
        if !scene.frames.iter().any(|f| f.id == "world") {
            return Err(SceneError::MissingWorld);
        }
        Ok(())
    }

    /// Verifica que todos los IDs de frames sean únicos.
    fn check_ids_unique(&self, scene: &VisualScene) -> Result<(), SceneError> {
        let mut seen = HashSet::new();
        for frame in &scene.frames {
            if !seen.insert(&frame.id) {
                return Err(SceneError::DuplicateId {
                    id: frame.id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Verifica que todo `parent` referenciado exista como frame.
    fn check_parents_exist(&self, scene: &VisualScene) -> Result<(), SceneError> {
        let ids: HashSet<&str> = scene.frames.iter().map(|f| f.id.as_str()).collect();

        for frame in &scene.frames {
            if let Some(ref parent) = frame.parent {
                if !ids.contains(parent.as_str()) {
                    return Err(SceneError::MissingFrame(parent.clone()));
                }
            }
        }
        Ok(())
    }

    /// Verifica que el grafo de frames no contenga ciclos (C1).
    ///
    /// Para cada frame, camina hacia arriba por la cadena de `parent`
    /// y detecta si vuelve a un frame ya visitado.
    fn check_no_cycles(&self, scene: &VisualScene) -> Result<(), SceneError> {
        let by_id: HashMap<&str, &VisualFrame> =
            scene.frames.iter().map(|f| (f.id.as_str(), f)).collect();

        for frame in &scene.frames {
            let mut visited = HashSet::new();
            let mut current: Option<&str> = Some(&frame.id);

            while let Some(id) = current {
                if !visited.insert(id) {
                    return Err(SceneError::BrokenTopology {
                        frame: frame.id.clone(),
                    });
                }
                current = by_id.get(id).and_then(|f| f.parent.as_deref());
            }
        }
        Ok(())
    }

    /// Verifica que todos los frames sean alcanzables desde `"world"` (C2).
    ///
    /// Construye lista de adyacencia (parent → children) y hace BFS
    /// desde `"world"`.
    fn check_connectivity(&self, scene: &VisualScene) -> Result<(), SceneError> {
        // Construir árbol parent → children
        let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
        for frame in &scene.frames {
            if let Some(ref parent) = frame.parent {
                children.entry(parent.as_str()).or_default().push(&frame.id);
            }
        }

        // BFS desde world
        let mut reachable = HashSet::new();
        let mut queue = vec!["world"];
        reachable.insert("world");

        while let Some(id) = queue.pop() {
            if let Some(kids) = children.get(id) {
                for child in kids {
                    if reachable.insert(child) {
                        queue.push(child);
                    }
                }
            }
        }

        // Verificar que todo frame sea alcanzable
        for frame in &scene.frames {
            if !reachable.contains(frame.id.as_str()) {
                return Err(SceneError::BrokenTopology {
                    frame: frame.id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Verifica que no haya valores `NaN` o `Inf` en la escena (R2).
    fn check_finite(&self, scene: &VisualScene) -> Result<(), SceneError> {
        for frame in &scene.frames {
            for &v in &frame.translation {
                if !v.is_finite() {
                    return Err(SceneError::NonFiniteValue {
                        frame: frame.id.clone(),
                    });
                }
            }
            for &v in &frame.rotation {
                if !v.is_finite() {
                    return Err(SceneError::NonFiniteValue {
                        frame: frame.id.clone(),
                    });
                }
            }
        }

        for (i, axis) in scene.joint_axes.iter().enumerate() {
            for &v in &axis.origin {
                if !v.is_finite() {
                    return Err(SceneError::NonFiniteValue {
                        frame: format!("joint_axis[{}]", i),
                    });
                }
            }
            for &v in &axis.axis {
                if !v.is_finite() {
                    return Err(SceneError::NonFiniteValue {
                        frame: format!("joint_axis[{}]", i),
                    });
                }
            }
        }

        // Twists no se checkean para finite en este nivel porque
        // pueden estar vacíos y dependen de Jacobiano externo.
        // El constructor ya canonicaliza.

        Ok(())
    }

    /// Verifica que la norma de cada cuaternión esté cerca de 1 (R1).
    fn check_quaternion_norm(&self, scene: &VisualScene) -> Result<(), SceneError> {
        for frame in &scene.frames {
            let r = &frame.rotation;
            let norm_sq = r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3];
            let diff = (norm_sq.sqrt() - 1.0).abs();
            if diff > self.epsilon_rot {
                return Err(SceneError::InvalidQuaternion {
                    frame: frame.id.clone(),
                    norm: norm_sq.sqrt(),
                });
            }
        }
        Ok(())
    }

    /// Verifica que cada link corresponda a un par (parent, child) de frames.
    ///
    /// Itera sobre los links en orden y verifica que exista un frame cuyo
    /// `translation == link.start` y cuyo child `translation == link.end`.
    ///
    /// Como el SceneBuilder construye links simultáneamente con los frames
    /// en orden de segmentos, esta verificación es O(n²) pero solo debe
    /// ejecutarse en debug / tests.
    fn check_links_consistency(&self, scene: &VisualScene) -> Result<(), SceneError> {
        // Build set of parent→child translation pairs
        let by_id: HashMap<&str, &VisualFrame> =
            scene.frames.iter().map(|f| (f.id.as_str(), f)).collect();

        let mut expected_links: Vec<([f64; 3], [f64; 3])> = Vec::new();
        for frame in &scene.frames {
            if let Some(ref parent) = frame.parent {
                if let Some(parent_frame) = by_id.get(parent.as_str()) {
                    expected_links.push((parent_frame.translation, frame.translation));
                }
            }
        }

        for (i, link) in scene.links.iter().enumerate() {
            // Check if this link matches any expected parent→child pair
            let matches = expected_links.iter().any(|(start, end)| {
                arrays_approx_eq(&link.start, start) && arrays_approx_eq(&link.end, end)
            });

            if !matches {
                return Err(SceneError::OrphanLink { index: i });
            }
        }

        Ok(())
    }

    /// Verifica que la cantidad de twists sea 0 o coincida con joint_axes.
    fn check_twists_consistency(&self, scene: &VisualScene) -> Result<(), SceneError> {
        let n_axes = scene.joint_axes.len();
        let n_twists = scene.twists.len();

        if n_twists > 0 && n_twists != n_axes {
            return Err(SceneError::TwistsMismatch {
                expected: n_axes,
                found: n_twists,
            });
        }
        Ok(())
    }
}

// ─── Helpers ──────────────────────────────────────────────────────

fn arrays_approx_eq(a: &[f64; 3], b: &[f64; 3]) -> bool {
    const EPS: f64 = 1e-10;
    (a[0] - b[0]).abs() < EPS && (a[1] - b[1]).abs() < EPS && (a[2] - b[2]).abs() < EPS
}
