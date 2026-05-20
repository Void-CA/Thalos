use crate::prelude::*;

pub fn create_planar_2r(
    l1: f64,
    l2: f64,
) -> SerialChain {

    let mut builder = SerialChainBuilder::new();

    // Frames
    let link_1_frame = builder
        .frames_mut()
        .create("link_1");

    let link_2_frame = builder
        .frames_mut()
        .create("link_2");

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
        RevoluteJoint {
            id: 1,

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

    // Explicit end effector
    builder.set_end_effector(link_2_frame);

    builder.build().unwrap()
}