use crate::{
    math::geometry::rigid::Transform3D, 
    robot::serial_chain::SerialChain
};

pub struct ForwardKinematics {
    chain: SerialChain,
}

impl ForwardKinematics {
    pub fn new(chain: SerialChain) -> Self {
        Self { chain }
    }

    pub fn evaluate(&self, q: &[f64]) -> Vec<Transform3D> {
        let mut t = Transform3D::identity();
        let mut results = Vec::new();

        for segment in &self.chain.segments {

            // 1. mover al frame del joint
            t = t.compose(segment.joint.origin());

            // 2. aplicar rotación/traslación del joint
            let q_i = q[segment.joint.id() as usize];
            let joint_t = segment.joint.motion(q_i);

            t = t.compose(&joint_t);

            // 3. aplicar geometría del link EN FRAME ROTADO
            t = t.compose(&segment.link.transform);

            results.push(t.clone());
        }

        results
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        kinematics::forward::ForwardKinematics, math::geometry::{rotations::
            Quaternion, rigid::Transform3D, vectors::{UnitVector3, Vector3}}, robot::{joint::{joint::{JointLimits, JointType}, revolute::RevoluteJoint}, link::Link, serial_chain::{Segment, SerialChain}}
    };

    fn build_simple_chain() -> SerialChain {
        let link = Link {
            id: 0,
            transform: Transform3D {
                translation: Vector3 { x: 1.0, y: 0.0, z: 0.0 },
                rotation: Quaternion::identity(),
            },
        };

        let joint = JointType::Revolute(
            RevoluteJoint::new(
                0,
                UnitVector3::new(Vector3 { x: 0.0, y: 0.0, z: 1.0 }).unwrap(),
                JointLimits {
                    min: -std::f64::consts::PI,
                    max: std::f64::consts::PI,
                },
                Transform3D::identity(),
            )
        );

        SerialChain {
            segments: vec![
                Segment { joint, link }
            ],
        }
    }

    #[test]
    fn fk_single_link_zero_rotation() {
        let chain = build_simple_chain(); // 1 segment

        let fk = ForwardKinematics::new(chain);

        let q = vec![0.0];

        let result = fk.evaluate(&q);

        let last = result.last().unwrap();

        assert!((last.translation.x - 1.0).abs() < 1e-6);
        assert!(last.translation.y.abs() < 1e-6);
        assert!(last.translation.z.abs() < 1e-6);
    }

    #[test]
    fn fk_single_link_90deg() {
        let chain = build_simple_chain();

        let fk = ForwardKinematics::new(chain);

        let q = vec![std::f64::consts::FRAC_PI_2];

        let result = fk.evaluate(&q);

        let last = result.last().unwrap();

        assert!((last.translation.x - 0.0).abs() < 1e-6);
        assert!((last.translation.y - 1.0).abs() < 1e-6);
    }

}