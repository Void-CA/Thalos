use thalos_math::{Quaternion, Transform3D, UnitQuaternion, UnitVector3, Vector3};
fn main()  {
    test_exam_rotate();
        

}

// fn testquat(){
//     let q1 = Quaternion::new(2.0, -1.0, 3.0, 4.0);
//         let q2 = Quaternion::new(-1.0 ,2.0, -1.0, 3.0);
//         let q3 = Quaternion::new(3.0, 1.0, 2.0, -1.0);
//         let q4 = Quaternion::new(1.0, -3.0, -2.0, 2.0);


//         let q5 = q1 + q2;

//         println!("1. q1 + q2:\n {:}\n", q5);

//         let q6 = q3 - q4;

//         println!("2. q3 - q4:\n {:}\n", q6);

//         let q_final = (q5 * q6) * q2;
//         println!("3. (q1 + q2) * (q3 - q2) * q2:\n {:}\n", q_final);

//         test_spatial_rotation();
// }
// fn test_spatial_rotation() {
//         let point = Vector3::new(2.0, -4.0, 4.0);
//         let axis = Vector3::new(1.0, 2.0, -2.0);
//         let norm = axis.norm();
//         let unit_axis = UnitVector3::new(axis).unwrap();

//         let angle : f64 = 60.0;
//         println!("================================");
//         println!("EL EJERCICIO DE ROSSMAN");
//         print!("===============================\n");
//         println!("Norma: {:}", norm);
//         println!("Vector unitario: {:}\n", unit_axis);

//         let q = UnitQuaternion::from_axis_angle(
//             unit_axis,
//             angle.to_radians()
//         );

//         println!("Q: {:}", q);
//         println!("Q norm: {:}", q.into_inner().norm());
//         println!("Q-1 {:}", q.inverse());

//         let p = Quaternion::new(0.0, point.x, point.y, point.z);
//         println!("Point as quaternion:\n {:}\n", p);
//         let w = p * q.into_inner();
//         println!("W: {:}", w);
//         println!("Rotated vector: {:}\n\n",  q.rotate_vector(point));

//     }

fn test_exam_rotate() {
    let p = Vector3::new(1.58, 12.0, 16.0);

    let R1 = UnitQuaternion::from_axis_angle(
        UnitVector3::z_axis(),
        67.0f64.to_radians(),
    );

    println!("R1: {:}", R1);

    let R2 = UnitQuaternion::from_axis_angle(
        UnitVector3::y_axis(),
        65.0f64.to_radians(),
    );

    println!("R2: {:}", R2);

    // T1: rotación + traslación normal
    let t1 = Transform3D {
        rotation: R1,
        translation: Vector3::new(12.5, 17.2, 4.95),
    };

    println!("T1: {:}", t1);

    // T2: traslación seguida de rotación (ajustada a SE(3))
    let t2 = Transform3D {
        rotation: R2,
        translation: R2.rotate_vector(Vector3::new(0.0, 1.0, 0.0)),
    };

    println!("T2: {:}", t2);
    let result = t1.compose(&t2).apply(p);

    println!("{:}", result);
}