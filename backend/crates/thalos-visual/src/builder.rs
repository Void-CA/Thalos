use thalos_core::{
    kinematics::{forward::result::FKResult, jacobian::Jacobian},
    math::geometry::{rigid::Transform3D, vectors::Vector3},
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};

use crate::scene::*;

// ── Helpers geométricos para construir primitives ──

/// Normaliza un vector 3D.
fn normalize(v: [f64; 3]) -> [f64; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len < 1e-15 {
        return [0.0, 1.0, 0.0];
    }
    [v[0] / len, v[1] / len, v[2] / len]
}

/// Devuelve un quaternion `[w, x, y, z]` que rota el eje Y (0,1,0) para alinearse
/// con `direction`. Útil para orientar cilindros cuyo eje default es Y (Three.js).
pub fn align_y_to(direction: [f64; 3]) -> [f64; 4] {
    let dir = normalize(direction);
    let y = [0.0, 1.0, 0.0];
    let dot = y[0] * dir[0] + y[1] * dir[1] + y[2] * dir[2];

    // Misma dirección → identidad
    if dot > 0.9999 {
        return [1.0, 0.0, 0.0, 0.0];
    }
    // Dirección opuesta → 180° alrededor de Z
    if dot < -0.9999 {
        return [0.0, 0.0, 0.0, 1.0];
    }

    // Producto vectorial: eje de rotación
    let axis = [
        y[1] * dir[2] - y[2] * dir[1],
        y[2] * dir[0] - y[0] * dir[2],
        y[0] * dir[1] - y[1] * dir[0],
    ];
    let axis = normalize(axis);

    let half = dot.acos() / 2.0;
    let s = half.sin();
    [half.cos(), axis[0] * s, axis[1] * s, axis[2] * s]
}

/// Construye un `VisualPrimitive::Cylinder` que va desde `from` hasta `to`.
/// El cilindro queda centrado en el punto medio, con la altura = distancia y
/// orientación alineada con la dirección del segmento.
pub fn cylinder_between(
    id: impl Into<String>,
    from: [f64; 3],
    to: [f64; 3],
    radius: f64,
) -> VisualPrimitive {
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    let dz = to[2] - from[2];
    let height = (dx * dx + dy * dy + dz * dz).sqrt();

    if height < 1e-10 {
        return VisualPrimitive::cylinder(id, radius, 0.0);
    }

    let midpoint = [(from[0] + to[0]) / 2.0, (from[1] + to[1]) / 2.0, (from[2] + to[2]) / 2.0];
    let rotation = align_y_to([dx / height, dy / height, dz / height]);

    VisualPrimitive { id: id.into(), translation: midpoint, rotation, geometry: PrimitiveGeometry::Cylinder { radius, height } }
}

// ── SceneBuilder ──

pub struct SceneBuilder {
    chain: SerialChain,
    precision: VisualPrecision,
}

impl SceneBuilder {
    pub fn new(chain: &SerialChain) -> Self {
        Self {
            chain: chain.clone(),
            precision: VisualPrecision::default(),
        }
    }

    pub fn with_precision(mut self, precision: VisualPrecision) -> Self {
        self.precision = precision;
        self
    }

    pub fn from_fk(&self, fk: &FKResult) -> VisualScene {
        let mut frames = Vec::new();
        let mut links = Vec::new();
        let mut joint_axes = Vec::new();

        let world_pose = fk.pose(&FrameId::World).expect("FKResult must contain world frame");
        frames.push(VisualFrame {
            id: self.resolve_visual_id(&FrameId::World),
            parent: None,
            translation: self.normalize_tx(world_pose.transform()),
            rotation: self.normalize_rot(world_pose.transform()),
            style: None,
        });

        for segment in &self.chain.segments {
            let child_pose = fk.pose(&segment.child).expect("Child frame pose not found");
            let parent_pose = fk.pose(&segment.parent).expect("Parent frame pose not found");

            frames.push(VisualFrame {
                id: self.resolve_visual_id(&segment.child),
                parent: Some(self.resolve_visual_id(&segment.parent)),
                translation: self.normalize_tx(child_pose.transform()),
                rotation: self.normalize_rot(child_pose.transform()),
                style: None,
            });

            links.push(VisualLink {
                id: segment.joint.id(),
                start: self.normalize_point(&parent_pose.transform().translation),
                end: self.normalize_point(&child_pose.transform().translation),
            });

            let joint_transform = parent_pose.transform().compose(segment.joint.origin());
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
            primitives: Vec::new(),
        }
    }

    pub fn from_fk_with_jacobian(&self, fk: &FKResult, jacobian: &Jacobian) -> VisualScene {
        let mut scene = self.from_fk(fk);

        for (i, segment) in self.chain.segments.iter().enumerate() {
            let parent_pose = fk.pose(&segment.parent).expect("Parent pose not found");
            let joint_transform = parent_pose.transform().compose(segment.joint.origin());

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

    fn normalize_tx(&self, transform: &Transform3D) -> [f64; 3] {
        let mut arr = [
            transform.translation.x,
            transform.translation.y,
            transform.translation.z,
        ];
        self.precision.normalize_3(&mut arr);
        arr
    }

    fn normalize_rot(&self, transform: &Transform3D) -> [f64; 4] {
        let q = transform.rotation.inner();
        let mut arr = [q.w, q.x, q.y, q.z];
        self.precision.normalize_4(&mut arr);

        let norm = (arr[0] * arr[0] + arr[1] * arr[1] + arr[2] * arr[2] + arr[3] * arr[3]).sqrt();
        if norm > 1e-15 {
            for v in arr.iter_mut() {
                *v /= norm;
            }
        }

        self.precision.normalize_4(&mut arr);
        arr
    }

    fn normalize_point(&self, v: &Vector3) -> [f64; 3] {
        let mut arr = [v.x, v.y, v.z];
        self.precision.normalize_3(&mut arr);
        arr
    }
}
