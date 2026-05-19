use std::collections::HashMap;

use crate::{
    kinematics::forward::result::FKResult, 
    math::geometry::rigid::Transform3D, 
    robot::serial_chain::SerialChain, 
    spatial::{frame::FrameId, pose::Pose}
};

pub struct ForwardKinematics {
    chain: SerialChain,
}

impl ForwardKinematics {
    pub fn new(chain: SerialChain) -> Self {
        Self { chain }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::single_revolute::single_revolute;
    use crate::math::constants::{EPS, PI};

    #[test]
    fn fk_single_revolute_zero_angle_returns_x_position() {
        let robot = single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        
        // Obtener la pose del único frame
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        // Verificar reference es World
        assert_eq!(
            pose.reference_id(),
            FrameId::World,
            "Reference should be World"
        );
        
        // Verificar posición: (1, 0, 0) - solo el link en X
        let t = &pose.transform().translation;
        assert!(
            (t.x - 1.0).abs() < EPS
                && t.y.abs() < EPS
                && t.z.abs() < EPS,
            "Position should be (1, 0, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn fk_single_revolute_pi_over_2_returns_y_position() {
        let robot = single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        // q = π/2 = 90 grados
        let result = fk.evaluate(&[PI / 2.0]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        // Verificar posición: (0, 1, 0) - link rotado 90° en Z
        let t = &pose.transform().translation;
        assert!(
            t.x.abs() < EPS
                && (t.y - 1.0).abs() < EPS
                && t.z.abs() < EPS,
            "Position should be (0, 1, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn fk_single_revolute_pi_returns_negative_x_position() {
        let robot = single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        // q = π = 180 grados
        let result = fk.evaluate(&[PI]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        // Verificar posición: (-1, 0, 0) - link rotado 180° en Z
        let t = &pose.transform().translation;
        assert!(
            (t.x + 1.0).abs() < EPS
                && t.y.abs() < EPS
                && t.z.abs() < EPS,
            "Position should be (-1, 0, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn fk_single_revolute_has_one_pose() {
        let robot = single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        let frames: Vec<_> = result.frames().collect();
        
        assert_eq!(frames.len(), 1, "Should have exactly one pose");
    }

    #[test]
    fn fk_single_revolute_pose_target_is_child_frame() {
        let robot = single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        assert_eq!(
            pose.target_id(),
            *child_frame,
            "Target frame should be the child frame"
        );
    }

    #[test]
    fn fk_single_revolute_pose_is_global() {
        let robot = single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        assert!(
            pose.is_global(),
            "Pose should be global (reference == World)"
        );
    }
}

