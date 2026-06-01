use thalos_core::{
    kinematics::{forward::result::FKResult, jacobian::Jacobian},
    math::geometry::{rigid::Transform3D, vectors::Vector3},
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};

use crate::scene::*;

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
        });

        for segment in &self.chain.segments {
            let child_pose = fk.pose(&segment.child).expect("Child frame pose not found");
            let parent_pose = fk.pose(&segment.parent).expect("Parent frame pose not found");

            frames.push(VisualFrame {
                id: self.resolve_visual_id(&segment.child),
                parent: Some(self.resolve_visual_id(&segment.parent)),
                translation: self.normalize_tx(child_pose.transform()),
                rotation: self.normalize_rot(child_pose.transform()),
            });

            links.push(VisualLink {
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
