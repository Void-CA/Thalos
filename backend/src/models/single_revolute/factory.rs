use crate::prelude::*;

pub fn create_single_revolute() -> SerialChain {
    let world = FrameId::World;
    let mut frames = FrameRegistry::new();
    let segment_1_frame_id = frames.create("joint_1");

    let joint_1 = JointType::Revolute(
        RevoluteJoint::new(
            0, 
            UnitVector3::new(Vector3::new(0.0, 0.0, 1.0)).unwrap(), 
            JointLimits::new(-std::f64::INFINITY, std::f64::INFINITY),
            Transform3D::identity()
        )
    );
        

    let link_1 = Link::new(
        0,
        Transform3D::from_translation(
            Vector3::new(1.0, 0.0, 0.0)
        ),
    );

    let segment = Segment {
        parent: world,
        child: segment_1_frame_id,

        joint: joint_1,
        link: link_1,
    };

    SerialChain{segments: vec![segment], frames}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::constants::EPS;
    #[test]
    fn single_revolute_has_one_segment() {
        let robot = create_single_revolute();
        assert_eq!(robot.segments.len(), 1, "Should have exactly one segment");
    }

    #[test]
    fn single_revolute_parent_is_world() {
        let robot = create_single_revolute();
        assert_eq!(
            robot.segments[0].parent,
            FrameId::World,
            "Segment parent should be World"
        );
    }

    #[test]
    fn single_revolute_child_frame_exists_in_registry() {
        let robot = create_single_revolute();
        let child_frame_id = &robot.segments[0].child;
        assert!(
            robot.frames.get(child_frame_id).is_some(),
            "Child frame should exist in registry"
        );
    }

    #[test]
    fn single_revolute_joint_is_revolute_with_z_axis() {
        let robot = create_single_revolute();
        let joint = &robot.segments[0].joint;

        match joint {
            JointType::Revolute(revolute) => {
                let axis = &revolute.axis;
                // El eje del joint debería ser (0, 0, 1) - eje Z
                assert!(
                    (axis.x.abs() < EPS)
                        && (axis.y.abs() < EPS)
                        && (axis.z - 1.0).abs() < EPS,
                    "Joint axis should be Z (0, 0, 1), got {:?}",
                    (axis.x, axis.y, axis.z)
                );
            }
            _ => panic!("Expected Revolute joint"),
        }
    }

    #[test]
    fn single_revolute_link_has_x_translation() {
        let robot = create_single_revolute();
        let link_transform = &robot.segments[0].link.transform;

        // El link tiene una translation de (1, 0, 0) - eje X
        let t = &link_transform.translation;
        assert!(
            (t.x - 1.0).abs() < EPS
                && t.y.abs() < EPS
                && t.z.abs() < EPS  ,
            "Link translation should be (1, 0, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn single_revolute_joint_has_correct_id() {
        let robot = create_single_revolute();
        let joint = &robot.segments[0].joint;
        
        match joint {
            JointType::Revolute(revolute) => {
                assert_eq!(revolute.id, 0, "Joint ID should be 0");
            }
            _ => panic!("Expected Revolute joint"),
        }
    }
}