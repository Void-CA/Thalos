use crate::{Transform3D, UnitQuaternion, UnitVector3, Vector3, geometry::DualQuaternion};

#[test]
fn ex_2() {
    let rotation = UnitQuaternion::from_axis_angle(
        UnitVector3::z_axis(),
        45_f64.to_radians(),
    );

    let transform = Transform3D::from_translation_rotation(
        Vector3::new(0.5, -1.0, 1.5),
        rotation,
    );

    println!("{}", transform);
    let dq: DualQuaternion = transform.into();
    let recovered: Transform3D = dq.into();

    
    println!("{}", recovered);
    println!("{}", dq);
}