use std::collections::HashMap;

use crate::{
    kinematics::forward::result::FKResult, 
    math::geometry::rigid::Transform3D, 
    robot::serial_chain::SerialChain, 
    spatial::{frame::FrameId, pose::Pose}
};

#[derive(Clone)]
pub struct ForwardKinematics {
    chain: SerialChain,
}

impl ForwardKinematics {
    pub fn new(chain: SerialChain) -> Self {
        Self { chain }
    }

    pub fn robot(&self) -> &SerialChain {
        &self.chain
    }

    pub fn evaluate(&self, q: &[f64]) -> FKResult {
        let mut t = Transform3D::identity();

        let mut poses = HashMap::new();

        let world = FrameId::World;

        for segment in &self.chain.segments {

            // joint local origin
            t = t.compose(segment.joint.origin());

            // joint motion
            let q_i = q[segment.joint.id() as usize];

            let joint_motion = segment.joint.motion(q_i);

            t = t.compose(&joint_motion);

            // rigid link transform
            t = t.compose(&segment.link.transform);

            // store global pose of child frame
            poses.insert(
                segment.child.clone(),
                Pose::new(
                    world.clone(),
                    segment.child.clone(),
                    t.clone(),
                ),
            );
        }

        FKResult::new(poses)
    }

}
