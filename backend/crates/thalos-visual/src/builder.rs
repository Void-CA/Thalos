use thalos_core::{
    kinematics::{
        forward::result::FKResult,
        jacobian::Jacobian,
    },
    math::geometry::{
        rigid::Transform3D,
        vectors::Vector3,
    },
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};

use crate::scene::*;

/// Construye una [`VisualScene`] a partir de datos cinemáticos del core.
///
/// # Filosofía
/// - Consume `SerialChain` + `FKResult` + opcionalmente `Jacobian`.
/// - No expone tipos internos del core en su output (solo DTOs).
/// - Produce un scene graph **determinístico y canónico**: el orden de
///   frames/links sigue la cadena cinemática, y todos los valores
///   numéricos se canonicalizan según [`VisualPrecision`].
/// - Resuelve `FrameId` a nombres legibles usando el `FrameRegistry`
///   como **única fuente de verdad** para identidad visual.
///
/// # Pipeline de canonicalización
///
/// El builder aplica dos capas independientes a toda salida numérica:
///
/// 1. **Canonicalizer** ([`VisualPrecision`]): redondeo a N decimales +
///    limpieza de sub-epsilon. Responsabilidad: estabilidad numérica.
/// 2. **Normalizer**: reparación de invariantes matemáticas que el
///    redondeo pueda haber dañado (ej: re-normalizar cuaternión a
///    unitario). Responsabilidad: validez geométrica.
pub struct SceneBuilder {
    chain: SerialChain,
    precision: VisualPrecision,
}

impl SceneBuilder {
    /// Crea un builder asociado a un robot (serial chain).
    ///
    /// Usa [`VisualPrecision::default()`] para canonicalización.
    /// Llamá a [`with_precision`](Self::with_precision) para personalizar.
    pub fn new(chain: &SerialChain) -> Self {
        Self {
            chain: chain.clone(),
            precision: VisualPrecision::default(),
        }
    }

    /// Configura la política de canonicalización numérica.
    pub fn with_precision(mut self, precision: VisualPrecision) -> Self {
        self.precision = precision;
        self
    }

    // ─── API pública ──────────────────────────────────────────

    /// Construye la escena base a partir de un resultado de FK.
    ///
    /// Incluye:
    /// - World frame
    /// - Todos los frames del robot con sus poses globales
    /// - Links visuales entre frames consecutivos
    /// - Ejes articulares en coordenadas globales
    ///
    /// Todos los valores numéricos se canonicalizan según la
    /// [`VisualPrecision`] configurada.
    pub fn from_fk(&self, fk: &FKResult) -> VisualScene {
        let mut frames = Vec::new();
        let mut links = Vec::new();
        let mut joint_axes = Vec::new();

        // World frame
        let world_pose = fk
            .pose(&FrameId::World)
            .expect("FKResult must contain world frame");
        frames.push(VisualFrame {
            id: self.resolve_visual_id(&FrameId::World),
            parent: None,
            translation: self.normalize_tx(world_pose.transform()),
            rotation: self.normalize_rot(world_pose.transform()),
        });

        // Frames en orden de cadena cinemática
        // INVARIANTE: SerialChain.segments mantiene orden topológico
        for segment in &self.chain.segments {
            let child_pose = fk
                .pose(&segment.child)
                .expect("Child frame pose not found in FKResult");
            let parent_pose = fk
                .pose(&segment.parent)
                .expect("Parent frame pose not found in FKResult");

            // Frame del child
            frames.push(VisualFrame {
                id: self.resolve_visual_id(&segment.child),
                parent: Some(self.resolve_visual_id(&segment.parent)),
                translation: self.normalize_tx(child_pose.transform()),
                rotation: self.normalize_rot(child_pose.transform()),
            });

            // Link: desde la posición del frame padre a la del frame hijo.
            // Se construyen simultáneamente con los frames, garantizando consistencia.
            links.push(VisualLink {
                start: self.normalize_point(&parent_pose.transform().translation),
                end: self.normalize_point(&child_pose.transform().translation),
            });

            // Eje articular en coordenadas globales
            let joint_transform = parent_pose
                .transform()
                .compose(segment.joint.origin());
            let axis = segment.joint.axis_world(&joint_transform);

            joint_axes.push(VisualJointAxis {
                origin: self.normalize_point(&joint_transform.translation),
                axis: self.normalize_point(&axis),
            });
        }

        VisualScene {
            frames,
            links,
            joint_axes,
            twists: Vec::new(),
        }
    }

    /// Construye la escena incluyendo las columnas del Jacobiano.
    ///
    /// Además de todo lo que produce `from_fk`, agrega un `VisualTwist`
    /// por cada columna del Jacobiano geométrico.
    pub fn from_fk_with_jacobian(&self, fk: &FKResult, jacobian: &Jacobian) -> VisualScene {
        let mut scene = self.from_fk(fk);

        for (i, segment) in self.chain.segments.iter().enumerate() {
            let parent_pose = fk
                .pose(&segment.parent)
                .expect("Parent pose not found");

            let joint_transform = parent_pose
                .transform()
                .compose(segment.joint.origin());

            scene.twists.push(VisualTwist {
                origin: self.normalize_point(&joint_transform.translation),
                linear: [
                    self.precision.normalize(jacobian.linear()[(0, i)]),
                    self.precision.normalize(jacobian.linear()[(1, i)]),
                    self.precision.normalize(jacobian.linear()[(2, i)]),
                ],
                angular: [
                    self.precision.normalize(jacobian.angular()[(0, i)]),
                    self.precision.normalize(jacobian.angular()[(1, i)]),
                    self.precision.normalize(jacobian.angular()[(2, i)]),
                ],
            });
        }

        scene
    }

    // ─── Identity resolution ──────────────────────────────────

    /// Única fuente de verdad para resolver `FrameId` → `VisualId`.
    ///
    /// # Invariantes
    /// - `FrameId::World` → `"world"` (constante canónica).
    /// - `FrameId::Id(n)` presente en registry → `f.name()`.
    /// - `FrameId::Id(n)` NO registrado → pánico (violación de contrato
    ///   de construcción: todo frame debe registrarse antes de construir
    ///   una escena).
    fn resolve_visual_id(&self, id: &FrameId) -> VisualId {
        match id {
            FrameId::World => "world".into(),
            id => self
                .chain
                .frames
                .get(id)
                .expect("scene contract violation: frame must exist in FrameRegistry")
                .name()
                .to_string(),
        }
    }

    // ─── Pipeline de canonicalización ─────────────────────────
    //
    // Cada método aplica dos capas:
    //   1. Canonicalizer (VisualPrecision): round + epsilon cleanup
    //   2. Normalizer: repair math invariants broken by rounding
    //

    /// Traslación: Canonicalizer + Normalizer.
    /// (traslaciones no requieren Normalizer adicional)
    fn normalize_tx(&self, transform: &Transform3D) -> [f64; 3] {
        let mut arr = [
            transform.translation.x,
            transform.translation.y,
            transform.translation.z,
        ];
        // Layer 1: Canonicalizer
        self.precision.normalize_3(&mut arr);
        arr
    }

    /// Rotación: Canonicalizer → Normalizer → Canonicalizer.
    ///
    /// Pipeline completo:
    ///   1. Redondear componentes (pierde unidad)
    ///   2. Re-normalizar a unitario (repara invariante SO(3))
    ///   3. Re-redondear (mantiene estabilidad de snapshot)
    fn normalize_rot(&self, transform: &Transform3D) -> [f64; 4] {
        let q = transform.rotation.inner();

        // --- Layer 1: Canonicalizer ---
        let mut arr = [q.w, q.x, q.y, q.z];
        self.precision.normalize_4(&mut arr);

        // --- Layer 2: Normalizer (repair unit norm) ---
        let norm = (arr[0] * arr[0]
            + arr[1] * arr[1]
            + arr[2] * arr[2]
            + arr[3] * arr[3])
            .sqrt();
        if norm > 1e-15 {
            for v in arr.iter_mut() {
                *v /= norm;
            }
        }

        // --- Layer 1 (again): re-canonicalize after normalizer ---
        self.precision.normalize_4(&mut arr);

        arr
    }

    /// Punto 3D: Canonicalizer + Normalizer.
    fn normalize_point(&self, v: &Vector3) -> [f64; 3] {
        let mut arr = [v.x, v.y, v.z];
        // Layer 1: Canonicalizer
        self.precision.normalize_3(&mut arr);
        arr
    }
}
