
use crate::prelude::*;
use crate::kinematics::inverse::solver::IKSolver;
use crate::math::algebra::vector::DynamicVector;
use std::f64::consts::PI;

// ─── Helpers ───────────────────────────────────────────────────────────

/// Brazo planar de 1-DOF: un único revolute con link de longitud `L`.
/// Joint en el origen, rotación alrededor de Z, link sobre X.
fn build_1dof_arm(length: f64) -> (ForwardKinematics, FrameId) {
    let mut builder = SerialChainBuilder::new();

    let ee = builder.create_frame("ee");

    let joint = JointType::Revolute(RevoluteJoint::new(
        0,
        UnitVector3::z_axis(),
        JointLimits::new(-PI, PI),
        Transform3D::identity(),
    ));

    let link = Link::new(0, Transform3D::from_translation(Vector3::new(length, 0.0, 0.0)));

    builder.add_segment(Segment::new(FrameId::World, ee.clone(), joint, link));
    builder.set_end_effector(ee.clone());

    let chain = builder.build().expect("1-DOF arm: builder failed");
    (ForwardKinematics::new(chain), ee)
}

/// Brazo planar de 2-DOF: L1 = L2 = 1, ambos revolute alrededor de Z.
/// q = [0, 0] → efector en (2, 0, 0).
fn build_2dof_planar_arm() -> (ForwardKinematics, FrameId) {
    let mut builder = SerialChainBuilder::new();

    let shoulder = builder.create_frame("shoulder");
    let ee = builder.create_frame("ee");

    // Segmento 1: World → shoulder
    let joint1 = JointType::Revolute(RevoluteJoint::new(
        0,
        UnitVector3::z_axis(),
        JointLimits::new(-PI, PI),
        Transform3D::identity(),
    ));
    let link1 = Link::new(0, Transform3D::from_translation(Vector3::new(1.0, 0.0, 0.0)));
    builder.add_segment(Segment::new(FrameId::World, shoulder.clone(), joint1, link1));

    // Segmento 2: shoulder → ee
    let joint2 = JointType::Revolute(RevoluteJoint::new(
        1,
        UnitVector3::z_axis(),
        JointLimits::new(-PI, PI),
        Transform3D::identity(),
    ));
    let link2 = Link::new(1, Transform3D::from_translation(Vector3::new(1.0, 0.0, 0.0)));
    builder.add_segment(Segment::new(shoulder, ee.clone(), joint2, link2));

    builder.set_end_effector(ee.clone());

    let chain = builder.build().expect("2-DOF arm: builder failed");
    (ForwardKinematics::new(chain), ee)
}

// ─── Tests ─────────────────────────────────────────────────────────────

/// 1. VALIDACIÓN BÁSICA: el error disminuye iteración a iteración.
///
/// Corre el loop manualmente para registrar la historia del error.
/// Verifica que el error nunca crezca (con tolerancia numérica 1e-12).
#[test]
fn test_error_decreases_monotonically() {
    let (fk, ee) = build_2dof_planar_arm();
    let jacobian = GeometricJacobian::new(fk.clone(), ee);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let max_iters = 500;
    let tolerance = 1e-6;
    let alpha = 0.5;

    let mut q = DynamicVector::from_column_slice(&q0);
    let mut prev_error = f64::MAX;
    let mut errors: Vec<f64> = Vec::new();
    let mut converged = false;

    for iter in 0..max_iters {
        let fk_result = fk.evaluate(q.as_slice());
        let p = fk_result.ee_position().unwrap();
        let error = target - p;
        let mag = error.magnitude();
        errors.push(mag);

        if mag < tolerance {
            converged = true;
            println!("  Converged in {} iterations, final error = {:.2e}", iter + 1, mag);
            prev_error = mag;
            break;
        }

        // El error debe decrecer (o mantenerse) consistentemente
        assert!(
            mag <= prev_error + 1e-12,
            "ERROR CRECIÓ: iter={}, prev={:.6}, current={:.6}",
            iter,
            prev_error,
            mag
        );

        let error_vec: DynamicVector = error.into();
        let jacobian_result = jacobian.evaluate(q.as_slice());
        let dq = alpha * (jacobian_result.linear().transpose() * error_vec);
        q += dq;

        prev_error = mag;
    }

    assert!(
        converged,
        "No convergió después de {} iteraciones: error final = {:.2e} (tolerancia = {:.2e})",
        max_iters,
        prev_error,
        tolerance
    );

    // Print de la serie de errores para inspección visual
    println!("\nEvolución del error (primeros 20):");
    for (i, e) in errors.iter().take(20).enumerate() {
        println!("  iter={:3}  error={:.6}", i, e);
    }
    if errors.len() > 20 {
        println!("  ... truncado ({} iteraciones totales)", errors.len());
    }
}

/// 2. CASO ANALÍTICO: brazo planar de 2-DOF.
///
/// L1 = L2 = 1, target (1, 1, 0).
/// Solución esperada: q1 ≈ 0°, q2 ≈ 90°.
#[test]
fn test_2dof_planar_arm_known_solution() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = IKSolver::new(fk, ee, 500, 1e-6, 0.5);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let q_solution = solver.solve(&q0, target);

    println!("  q1 = {:.6} rad ({:.2}°)", q_solution[0], q_solution[0].to_degrees());
    println!("  q2 = {:.6} rad ({:.2}°)", q_solution[1], q_solution[1].to_degrees());

    assert!(
        q_solution[0].abs() < 1e-2,
        "Esperado q1 ≈ 0, got {}",
        q_solution[0]
    );
    assert!(
        (q_solution[1] - PI / 2.0).abs() < 1e-2,
        "Esperado q2 ≈ π/2, got {}",
        q_solution[1]
    );
}

/// 3. CONSISTENCIA FK: después de IK, FK(position(q)) ≈ target.
#[test]
fn test_fk_ik_consistency() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = IKSolver::new(fk.clone(), ee, 500, 1e-6, 0.5);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let q_solution = solver.solve(&q0, target);

    // FK desde la solución de IK
    let fk_result = fk.evaluate(&q_solution);
    let reached = fk_result.ee_position().unwrap();
    let final_error = (target - reached).magnitude();

    println!(
        "  target  = ({:.4}, {:.4}, {:.4})",
        target.x, target.y, target.z
    );
    println!(
        "  reached = ({:.4}, {:.4}, {:.4})",
        reached.x, reached.y, reached.z
    );
    println!("  final error = {:.2e}", final_error);

    assert!(
        final_error < 1e-5,
        "FK/IK mismatch: error = {:.2e} (tolerancia IK = 1e-6)",
        final_error
    );
}

/// 4. VERIFICACIÓN DEL JACOBIANO: geométrico vs. numérico.
///
/// Para múltiples configuraciones, compara cada columna del Jacobiano
/// lineal obtenido por método geométrico contra diferencias finitas.
#[test]
fn test_jacobian_matches_numerical() {
    let (fk, ee) = build_2dof_planar_arm();

    let geometric = GeometricJacobian::new(fk.clone(), ee.clone());
    let numerical = NumericalJacobian::new(fk, ee);

    let test_configs: Vec<Vec<f64>> = vec![
        vec![0.0, 0.0],
        vec![0.5, 0.3],
        vec![1.0, -0.5],
        vec![-0.8, 1.2],
        vec![PI / 4.0, PI / 3.0],
    ];

    let tolerance = 1e-4;

    for q in &test_configs {
        let j_geom = geometric.evaluate(q);
        let j_num = numerical.evaluate(q);

        for i in 0..3 {
            // fila (x, y, z)
            for j in 0..q.len() {
                // columna (joint)
                let g = j_geom.linear()[(i, j)];
                let n = j_num.linear()[(i, j)];
                let diff = (g - n).abs();
                assert!(
                    diff < tolerance,
                    "Jacobiano mismatch en q = [{:.3}, {:.3}]: \
                        J_geom[{}][{}] = {:.6}, J_num[{}][{}] = {:.6}, diff = {:.2e}",
                    q[0], q[1], i, j, g, i, j, n, diff
                );
            }
        }
    }
}

/// 5. CASO EXTREMADAMENTE SIMPLE: 1-DOF.
///
/// L = 1, target (0, 1, 0).
/// Solución analítica: θ = π/2.
#[test]
fn test_1dof_reaches_known_target() {
    let (fk, ee) = build_1dof_arm(1.0);
    let solver = IKSolver::new(fk, ee, 100, 1e-6, 0.5);

    let q0 = vec![0.0];
    let target = Vector3::new(0.0, 1.0, 0.0);
    let q_solution = solver.solve(&q0, target);

    println!("  θ = {:.6} rad ({:.2}°)", q_solution[0], q_solution[0].to_degrees());

    assert!(
        (q_solution[0] - PI / 2.0).abs() < 1e-3,
        "Esperado θ ≈ π/2, got {}",
        q_solution[0]
    );
}
