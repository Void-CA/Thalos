use core::f64;
use std::f64::consts::{FRAC_PI_2, PI};
use thalos_math::Matrix4x4;
use thalos_math::dh::{DHParameter, DHSolver, GeometricLink, JointType, generate_dh_table};

fn main() {
    let q1 = PI / 4.0;
    let l1 = 1.0;

    let q2 = 2.0;
    let alfa = PI / 2.0;
    let q3 = 1.0;

    let params = vec![
        DHParameter::new(0.0, 0.0, l1, q1),
        DHParameter::new(0.0, 0.0, q2, 0.0),
        DHParameter::new(alfa, 0.0, q3, 0.0),
    ];
    let solver = DHSolver::new(params);
    let solution = solver.solve();
    println!("{solution}");
}
