use crate::{
    math::geometry::rigid::Transform3D, 
    robot::serial_chain::SerialChain, 
    spatial::{frame::Frame, pose::Pose}
};

pub struct ForwardKinematics {
    chain: SerialChain,
}

impl ForwardKinematics {
    pub fn new(chain: SerialChain) -> Self {
        Self { chain }
    }

    pub fn evaluate(&self, q: &[f64]) -> Vec<Pose> {
        let mut t = Transform3D::identity();
        let mut results = Vec::new();
        let world_frame = Frame::world();

        for segment in &self.chain.segments {

            // 1. mover al frame del joint
            t = t.compose(segment.joint.origin());

            // 2. aplicar rotación/traslación del joint
            let q_i = q[segment.joint.id() as usize];
            let joint_t = segment.joint.motion(q_i);

            t = t.compose(&joint_t);

            // 3. aplicar geometría del link EN FRAME ROTADO
            t = t.compose(&segment.link.transform);

            results.push(Pose::new(
                world_frame.id(),
                segment.frame_id(),
                t.clone()
            ));
        }

        results
    }
}

