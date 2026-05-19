use crate::models::*;

pub fn planar_2r(l1: f64, l2: f64) -> SerialChain {

    let mut chain = SerialChain {
        segments: Vec::new(),
        frames: FrameRegistry::new(),
    };

    // Frames
    let link_1_frame = chain.frames.create("link_1");

    let link_2_frame = chain.frames.create("link_2");

    // Joint 1
    let joint1 = JointType::Revolute(
        RevoluteJoint {
            id: 0,

            axis: UnitVector3::new(
                Vector3::new(0.0, 0.0, 1.0)
            ).unwrap(),

            limits: JointLimits {
                min: -PI,
                max: PI,
            },

            origin: Transform3D::identity(),
        }
    );

    // Link 1
    let link1 = Link {
        id: 0,

        transform: Transform3D::from_translation(
            Vector3::new(l1, 0.0, 0.0)
        ),
    };

    // Segment 1
    let segment1 = Segment {
        parent: FrameId::World,

        child: link_1_frame.clone(),

        joint: joint1,

        link: link1,
    };

    chain.segments.push(segment1);

    // Joint 2
    let joint2 = RevoluteJoint {
        id: 1,

        axis: UnitVector3::new(
            Vector3::new(0.0, 0.0, 1.0)
        ).unwrap(),

        limits: JointLimits {
            min: -PI,
            max: PI,
        },

        origin: Transform3D::identity(),
    };

    // Link 2
    let link2 = Link {
        id: 1,

        transform: Transform3D::from_translation(
            Vector3::new(5.0, 0.0, 0.0)
        ),
    };

    // Segment 2
    let segment2 = Segment {
        parent: link_1_frame,

        child: link_2_frame,

        joint: JointType::Revolute(joint2),

        link: link2,
    };

    chain.segments.push(segment2);

    chain
}

mod tests {
    use super::*;
    use crate::kinematics::forward::ForwardKinematics;

    #[test]
    fn testing() {
        let robot = planar_2r();
        let ee_id = *robot.end_effector().unwrap();
        let fk = ForwardKinematics::new(robot);

        let q1 = PI / 4.0; // 45 degrees
        let q2 = - PI / 6.0; // -30 degrees
        let result = fk.evaluate(&[q1, q2]);

        
        let ee_pose = result.pose(&ee_id).unwrap();
        println!("End Effector Position: {:?}", ee_pose.transform().translation);
    }
}