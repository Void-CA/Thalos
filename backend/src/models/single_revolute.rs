use crate::models::*;

pub fn single_revolute() -> SerialChain {
    let world = FrameId::World;

    let joint_1_frame_id = FrameId::new(1);

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
        child: joint_1_frame_id,

        joint: joint_1,
        link: link_1,
    };

    SerialChain::new(vec![segment], vec![])
}