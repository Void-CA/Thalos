use std::f64::consts::FRAC_PI_2;
use thalos_math::dh::{DHParameter, DHSolver, GeometricLink, JointType, generate_dh_table};
use thalos_math::Matrix4x4;

fn main() {
    // ── CASO 1: Robot planar 2R ────────────────────────────────
    println!("  EJEMPLO 1: Robot planar 2R                      ");
    println!("  L1 = 0.5, L2 = 0.3, θ₁ = 45°, θ₂ = 30°          ");

    let params = vec![
        DHParameter::new(0.0, 0.5, 0.0, std::f64::consts::FRAC_PI_4),
        DHParameter::new(0.0, 0.3, 0.0, std::f64::consts::FRAC_PI_6),
    ];
    let solver = DHSolver::new(params);
    let solution = solver.solve();
    println!("{solution}");

    // ── CASO 2: SCARA simplificado ─────────────────────────────
    println!("\n\n");
    println!("  EJEMPLO 2: SCARA (R-R-P)     ");
    println!("desde descripción geométrica ");
    println!("");

    let links = vec![
        GeometricLink {
            joint_type: JointType::Revolute,
            alpha: 0.0, a: 0.5, d: 0.3, theta: FRAC_PI_2,
        },
        GeometricLink {
            joint_type: JointType::Revolute,
            alpha: 0.0, a: 0.4, d: 0.0, theta: 0.5,
        },
        GeometricLink {
            joint_type: JointType::Prismatic,
            alpha: 0.0, a: 0.0, d: 0.2, theta: 0.0,
        },
    ];

    let table = generate_dh_table(&links);
    let solver = DHSolver::new(table);
    let solution = solver.solve();
    println!("{solution}");

    // ── CASO 3: Descomposición T → (R, p) manual ───────────────
    println!("\n\n");
    println!("  EJEMPLO 3: Descomposición T → (R, p) manual         ");
    println!("");

    let r = [[0.0, -1.0, 0.0],
             [1.0,  0.0, 0.0],
             [0.0,  0.0, 1.0]];
    let p = thalos_math::Vector3::new(0.5, 0.3, 0.0);
    let t = Matrix4x4::from_rp(r, p);

    let (r_extracted, p_extracted) = t.decompose();
    println!("T desde (R, p):");
    println!("{t}");
    println!("R extraída:");
    for i in 0..3 {
        if i == 0 { print!("⎡"); }
        else if i == 2 { print!("⎣"); }
        else { print!("⎢"); }
        for j in 0..3 {
            print!(" {:>8.4} ", r_extracted[i][j]);
        }
        if i == 0 { println!(" ⎤"); }
        else if i == 2 { println!(" ⎦"); }
        else { println!(" ⎥"); }
    }
    println!("\np extraído = [{:.4}, {:.4}, {:.4}]ᵀ", p_extracted.x, p_extracted.y, p_extracted.z);
}
