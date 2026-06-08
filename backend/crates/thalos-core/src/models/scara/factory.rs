use crate::prelude::*;

pub fn create_scara_robot(
    base_height: f64,  // Altura de la base (elevación del joint 1)
    l1: f64,           // Longitud del primer brazo
    l2: f64,           // Longitud del segundo brazo
    z_min: f64,        // Límite inferior del eje Z
    z_max: f64,        // Límite superior del eje Z
) -> SerialChain {

    let mut builder = SerialChainBuilder::new();

    // Frames (marcos de referencia)
    let base_frame = builder.create_frame("base");
    let link_1_frame = builder.create_frame("link_1");
    let link_2_frame = builder.create_frame("link_2");
    let prismatic_frame = builder.create_frame("prismatic_joint");
    let wrist_frame = builder.create_frame("wrist");

    // ── Segmento 0: Base fija ──────────────────────────────────
    // La base es un joint fijo que eleva la cadena a base_height.
    // No consume q, no contribuye al Jacobiano.
    let base_joint = JointType::Fixed(
        FixedJoint::new(
            Transform3D::from_translation(
                Vector3::new(0.0, base_height, 0.0)
            )
        )
    );

    let base_link = Link {
        id: 0,
        transform: Transform3D::identity(),
    };

    builder.add_segment(Segment {
        parent: FrameId::World,
        child: base_frame.clone(),
        joint: base_joint,
        link: base_link,
    });

    // ── Segmento 1: Revoluta en Y (base rotacional) ────────────
    let joint1 = JointType::Revolute(
        RevoluteJoint::new(
            0,
            UnitVector3::y_axis(),
            JointLimits::new(-PI, PI),
            Transform3D::identity(),
        )
    );

    let link1 = Link {
        id: 1,
        transform: Transform3D::from_translation(
            Vector3::new(l1, 0.0, 0.0)
        ),
    };

    builder.add_segment(Segment {
        parent: base_frame,
        child: link_1_frame.clone(),
        joint: joint1,
        link: link1,
    });

    // ── Segmento 2: Revoluta en Y (codo) ───────────────────────
    let joint2 = JointType::Revolute(
        RevoluteJoint::new(
            1,
            UnitVector3::y_axis(),
            JointLimits::new(-PI, PI),
            Transform3D::identity()
        )
    );

    let link2 = Link {
        id: 2,
        transform: Transform3D::from_translation(
            Vector3::new(l2, 0.0, 0.0)
        ),
    };

    builder.add_segment(Segment {
        parent: link_1_frame,
        child: link_2_frame.clone(),
        joint: joint2,
        link: link2,
    });

    // ── Segmento 3: Prismática en Y (vertical) ────────────────
    let joint3 = JointType::Prismatic(
        PrismaticJoint::new(
            2,
            UnitVector3::y_axis(),
            JointLimits::new(z_min, z_max),
            Transform3D::identity()
        )
    );

    let link3 = Link {
        id: 3,
        transform: Transform3D::identity(),
    };

    builder.add_segment(Segment {
        parent: link_2_frame,
        child: prismatic_frame.clone(),
        joint: joint3,
        link: link3,
    });

    // ── Segmento 4: Revoluta en Y (muñeca) ─────────────────────
    let joint4 = JointType::Revolute(
        RevoluteJoint::new(
            3,
            UnitVector3::y_axis(),
            JointLimits::new(-PI, PI),
            Transform3D::identity()
        )
    );

    let link4 = Link {
        id: 4,
        transform: Transform3D::from_translation(
            Vector3::new(0.0, 0.0, 0.0)
        ),
    };

    builder.add_segment(Segment {
        parent: prismatic_frame,
        child: wrist_frame.clone(),
        joint: joint4,
        link: link4,
    });

    // Establecer el efector final
    builder.set_end_effector(wrist_frame);

    builder.build().unwrap()
}
