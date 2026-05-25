use crate::prelude::*;

pub fn create_planar_3r(
    l1: f64,
    l2: f64,
    l3: f64,
) -> SerialChain {

    let mut builder = SerialChainBuilder::new();

    // Frames
    let link_1_frame = builder.create_frame("link_1");

    let link_2_frame = builder.create_frame("link_2");

    let link_3_frame = builder.create_frame("link_3");
    // Joint 1
    let joint1 = JointType::Revolute(
        RevoluteJoint::new(
            0, 
            UnitVector3::z_axis(), 
            JointLimits::new(-PI, PI), 
            Transform3D::identity()
        )
    );

    // Link 1
    let link1 = Link {
        id: 0,

        transform: Transform3D::from_translation(
            Vector3::new(l1, 0.0, 0.0)
        ),
    };

    // Segment 1
    builder.add_segment(
        Segment {
            parent: FrameId::World,

            child: link_1_frame.clone(),

            joint: joint1,

            link: link1,
        }
    );

    // Joint 2
    let joint2 = JointType::Revolute(
        RevoluteJoint::new(
            1,
            UnitVector3::z_axis(),
            JointLimits::new(-PI, PI),
            Transform3D::identity()
        )
    );

    // Link 2
    let link2 = Link {
        id: 1,

        transform: Transform3D::from_translation(
            Vector3::new(l2, 0.0, 0.0)
        ),
    };

    // Segment 2
    builder.add_segment(
        Segment {
            parent: link_1_frame,

            child: link_2_frame.clone(),

            joint: joint2,

            link: link2,
        }
    );

    // Joint 3
    let joint3 = JointType::Revolute(
        RevoluteJoint::new(
            2,
            UnitVector3::z_axis(),
            JointLimits::new(-PI, PI),
            Transform3D::identity()
        )
    );

    // Link 3
    let link3 = Link {
        id: 2,
        transform: Transform3D::from_translation(
            Vector3::new(l3, 0.0, 0.0)
        ),
    };

    // Segment 3
    builder.add_segment(
        Segment {
            parent: link_2_frame,
            child: link_3_frame,
            joint: joint3,
            link: link3,
        }
    );

    // Explicit end effector
    builder.set_end_effector(link_3_frame);

    builder.build().unwrap()
}

