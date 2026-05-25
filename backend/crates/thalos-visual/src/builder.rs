use thalos_core::{
    kinematics::{
        forward::result::FKResult,
        jacobian::Jacobian,
    },
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};

use crate::scene::*;
pub struct SceneBuilder {
    chain: SerialChain,
}

impl SceneBuilder {
    pub fn new(chain: &SerialChain) -> Self {
        Self {
            chain: chain.clone(),
        }
    }

    // ─── API pública ──────────────────────────────────────────

    /// Construye la escena base a partir de un resultado de FK.
    ///
    /// Incluye:
    /// - World frame
    /// - Todos los frames del robot con sus poses globales
    /// - Links visuales entre frames consecutivos
    /// - Ejes articulares en coordenadas globales
    pub fn from_fk(&self, fk: &FKResult) -> VisualScene {
        let mut frames = Vec::new();
        let mut links = Vec::new();
        let mut joint_axes = Vec::new();

        // World frame
        let world_pose = fk
            .pose(&FrameId::World)
            .expect("FKResult must contain world frame");
        frames.push(VisualFrame {
            id: "world".into(),
            parent: None,
            translation: self.translation_to_array(world_pose.transform()),
            rotation: self.rotation_to_array(world_pose.transform()),
        });

        // Frames en orden de cadena cinemática
        for segment in &self.chain.segments {
            let child_pose = fk
                .pose(&segment.child)
                .expect("Child frame pose not found in FKResult");
            let parent_pose = fk
                .pose(&segment.parent)
                .expect("Parent frame pose not found in FKResult");

            let child_name = self.frame_name(&segment.child);
            let parent_name = self.frame_name(&segment.parent);

            // Frame del child
            frames.push(VisualFrame {
                id: child_name,
                parent: if matches!(segment.parent, FrameId::World) {
                    Some("world".into())
                } else {
                    Some(parent_name)
                },
                translation: self.translation_to_array(child_pose.transform()),
                rotation: self.rotation_to_array(child_pose.transform()),
            });

            // Link: desde la posición del frame padre a la del frame hijo
            links.push(VisualLink {
                start: [
                    parent_pose.transform().translation.x,
                    parent_pose.transform().translation.y,
                    parent_pose.transform().translation.z,
                ],
                end: [
                    child_pose.transform().translation.x,
                    child_pose.transform().translation.y,
                    child_pose.transform().translation.z,
                ],
            });

            // Eje articular en coordenadas globales
            let joint_transform = parent_pose
                .transform()
                .compose(segment.joint.origin());
            let axis = segment.joint.axis_world(&joint_transform);

            joint_axes.push(VisualJointAxis {
                origin: [
                    joint_transform.translation.x,
                    joint_transform.translation.y,
                    joint_transform.translation.z,
                ],
                axis: [axis.x, axis.y, axis.z],
            });
        }

        VisualScene {
            frames,
            links,
            joint_axes,
            twists: Vec::new(),
        }
    }

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
                origin: [
                    joint_transform.translation.x,
                    joint_transform.translation.y,
                    joint_transform.translation.z,
                ],
                linear: [
                    jacobian.linear()[(0, i)],
                    jacobian.linear()[(1, i)],
                    jacobian.linear()[(2, i)],
                ],
                angular: [
                    jacobian.angular()[(0, i)],
                    jacobian.angular()[(1, i)],
                    jacobian.angular()[(2, i)],
                ],
            });
        }

        scene
    }

    // ─── Helpers ──────────────────────────────────────────────

    fn frame_name(&self, id: &FrameId) -> String {
        match id {
            FrameId::World => "world".into(),
            id => self
                .chain
                .frames
                .get(id)
                .map(|f| f.name().to_string())
                .unwrap_or_else(|| format!("frame_{}", match_id(id))),
        }
    }

    fn translation_to_array(
        &self,
        transform: &thalos_core::math::geometry::rigid::Transform3D,
    ) -> [f64; 3] {
        [
            transform.translation.x,
            transform.translation.y,
            transform.translation.z,
        ]
    }

    fn rotation_to_array(
        &self,
        transform: &thalos_core::math::geometry::rigid::Transform3D,
    ) -> [f64; 4] {
        let q = transform.rotation.inner();
        [q.w, q.x, q.y, q.z]
    }
}

fn match_id(id: &FrameId) -> u64 {
    match id {
        FrameId::Id(n) => *n,
        FrameId::World => unreachable!(),
    }
}

