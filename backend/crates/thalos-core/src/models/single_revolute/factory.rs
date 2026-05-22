use crate::prelude::*;

pub fn create_single_revolute() -> SerialChain {
    let mut builder = SerialChainBuilder::new();
    let link_1_frame = builder.create_frame("link_1");


    let joint1 = JointType::Revolute(
        RevoluteJoint::new(
            0, 
            UnitVector3::z_axis(), 
            JointLimits::new(-PI, PI), 
            Transform3D::identity()
        )
    );

    let link1 = Link {
        id: 0,

        transform: Transform3D::from_translation(
            Vector3::new(1.0, 0.0, 0.0)
        ),
    };

    builder.add_segment(
        Segment { 
            parent: FrameId::World,
            child: link_1_frame,
            joint: joint1,
            link: link1 
        }
    );

    builder.set_end_effector(link_1_frame);

    builder.build().unwrap()
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::constants::EPS;
    #[test]
    fn has_one_segment() {
        let robot = create_single_revolute();
        assert_eq!(robot.segments.len(), 1, "Should have exactly one segment");
    }

    #[test]
    fn parent_is_world() {
        let robot = create_single_revolute();
        assert_eq!(
            robot.segments[0].parent,
            FrameId::World,
            "Segment parent should be World"
        );
    }

    #[test]
    fn child_frame_exists_in_registry() {
        let robot = create_single_revolute();
        let child_frame_id = &robot.segments[0].child;
        assert!(
            robot.frames.get(child_frame_id).is_some(),
            "Child frame should exist in registry"
        );
    }

    #[test]
    fn joint_is_revolute_with_z_axis() {
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
    fn link_has_x_translation() {
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
    fn joint_has_correct_id() {
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