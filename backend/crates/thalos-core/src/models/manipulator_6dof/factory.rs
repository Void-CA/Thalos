use crate::prelude::*;

/// Crea un manipulador 6DOF estilo PUMA/UR con convención Z-up.
///
/// Cinemática:
///   J1 (Z) → l1 vertical → J2 (Y) → l2 horizontal → J3 (Y) → l3 horizontal
///   → J4 (X, roll antebrazo) → l4 → J5 (Y, pitch muñeca) → l5
///   → J6 (X, roll muñeca) → l6 → end-effector
pub fn create_manipulator_6dof(
    l1: f64,
    l2: f64,
    l3: f64,
    l4: f64,
    l5: f64,
    l6: f64,
    limits_j1: JointLimits,
    limits_j2: JointLimits,
    limits_j3: JointLimits,
    limits_j4: JointLimits,
    limits_j5: JointLimits,
    limits_j6: JointLimits,
) -> SerialChain {
    let mut builder = SerialChainBuilder::new();

    let f_link1 = builder.create_frame("link_1");
    let f_link2 = builder.create_frame("link_2");
    let f_link3 = builder.create_frame("link_3");
    let f_link4 = builder.create_frame("link_4");
    let f_link5 = builder.create_frame("link_5");
    let f_link6 = builder.create_frame("link_6");

    // Joint 1 — base rotation, eje Z (vertical)
    let joint1 = JointType::Revolute(
        RevoluteJoint::new(0, UnitVector3::z_axis(), limits_j1, Transform3D::identity()),
    );
    let link1 = Link {
        id: 0,
        transform: Transform3D::from_translation(Vector3::new(0.0, 0.0, l1)),
    };
    builder.add_segment(Segment {
        parent: FrameId::World,
        child: f_link1.clone(),
        joint: joint1,
        link: link1,
    });

    // Joint 2 — shoulder pitch, eje Y (horizontal)
    let joint2 = JointType::Revolute(
        RevoluteJoint::new(1, UnitVector3::y_axis(), limits_j2, Transform3D::identity()),
    );
    let link2 = Link {
        id: 1,
        transform: Transform3D::from_translation(Vector3::new(l2, 0.0, 0.0)),
    };
    builder.add_segment(Segment {
        parent: f_link1,
        child: f_link2.clone(),
        joint: joint2,
        link: link2,
    });

    // Joint 3 — elbow pitch, eje Y (paralelo a J2)
    let joint3 = JointType::Revolute(
        RevoluteJoint::new(2, UnitVector3::y_axis(), limits_j3, Transform3D::identity()),
    );
    let link3 = Link {
        id: 2,
        transform: Transform3D::from_translation(Vector3::new(l3, 0.0, 0.0)),
    };
    builder.add_segment(Segment {
        parent: f_link2,
        child: f_link3.clone(),
        joint: joint3,
        link: link3,
    });

    // Joint 4 — wrist roll, eje X (a lo largo del antebrazo)
    let joint4 = JointType::Revolute(
        RevoluteJoint::new(3, UnitVector3::x_axis(), limits_j4, Transform3D::identity()),
    );
    let link4 = Link {
        id: 3,
        transform: Transform3D::from_translation(Vector3::new(l4, 0.0, 0.0)),
    };
    builder.add_segment(Segment {
        parent: f_link3,
        child: f_link4.clone(),
        joint: joint4,
        link: link4,
    });

    // Joint 5 — wrist pitch, eje Y (perpendicular a J4)
    let joint5 = JointType::Revolute(
        RevoluteJoint::new(4, UnitVector3::y_axis(), limits_j5, Transform3D::identity()),
    );
    let link5 = Link {
        id: 4,
        transform: Transform3D::from_translation(Vector3::new(l5, 0.0, 0.0)),
    };
    builder.add_segment(Segment {
        parent: f_link4,
        child: f_link5.clone(),
        joint: joint5,
        link: link5,
    });

    // Joint 6 — wrist yaw/roll, eje X (perpendicular a J5)
    let joint6 = JointType::Revolute(
        RevoluteJoint::new(5, UnitVector3::x_axis(), limits_j6, Transform3D::identity()),
    );
    let link6 = Link {
        id: 5,
        transform: Transform3D::from_translation(Vector3::new(l6, 0.0, 0.0)),
    };
    builder.add_segment(Segment {
        parent: f_link5,
        child: f_link6.clone(),
        joint: joint6,
        link: link6,
    });

    builder.set_end_effector(f_link6);
    builder.build().unwrap()
}
