use super::*;

// ─── Tests ─────────────────────────────────────────────────────────────

/// 1. EL RESULTADO EXPONE ESTADO: verifica que IKResult tenga status,
///    iterations y final_error correctamente poblados.
#[test]
fn test_result_exposes_metadata() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let result = solver.solve(&q0, target);

    // IKResult debe contener la solución
    assert_eq!(result.q.len(), 2, "Solución debe tener 2 joint values");

    // Debe haber convergido (error < tolerancia)
    assert!(
        result.status.is_converged(),
        "Debe converger: status={:?}, final_error={:.2e}, iterations={}",
        result.status,
        result.final_error,
        result.iterations
    );

    // Iteraciones debe ser > 0 y razonable
    assert!(result.iterations > 0, "Debe haber al menos 1 iteración");
    assert!(result.iterations < 500, "No debería agotar max_iters");
    assert!(
        result.iterations < 100,
        "Jacobian Transpose con alpha=0.5 debería converger en <100 iteraciones para este caso, tomó {}",
        result.iterations
    );

    // Error final debe estar dentro de tolerancia
    assert!(
        result.final_error < 1e-5,
        "Error final ({:.2e}) muy por encima de tolerancia (1e-6)",
        result.final_error
    );

    // Por defecto no hay historial
    assert!(result.error_history.is_none(), "Historial debe ser None por defecto");
}

/// 2. HISTORIAL DE ERRORES: con with_history(true) se registra.
#[test]
fn test_error_history_is_recorded() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5)
        .with_history(true);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let result = solver.solve(&q0, target);

    let history = result
        .error_history
        .expect("with_history(true) debe registrar historial");

    assert_eq!(
        history.len(),
        result.iterations,
        "Historial debe tener {} entradas (== iterations)",
        result.iterations
    );

    // El primer error debe ser significativo (el ee empieza en (2,0,0), target (1,1,0))
    assert!(
        history[0] > 0.5,
        "Error inicial debe ser grande, fue {:.4}",
        history[0]
    );

    // El último error debe coincidir con final_error
    let last = history.last().unwrap();
    assert!(
        (last - result.final_error).abs() < 1e-12,
        "Último historial ({:.2e}) debe coincidir con final_error ({:.2e})",
        last,
        result.final_error
    );

    // Imprimir evolución para inspección visual
    println!("Evolución del error (historial completo, {} iteraciones):", history.len());
    for (i, e) in history.iter().enumerate() {
        println!("  iter={:3}  error={:.6}", i, e);
    }
}

/// 3. CASO ANALÍTICO: brazo planar de 2-DOF.
///
/// L1 = L2 = 1, target (1, 1, 0).
/// Solución esperada: q1 ≈ 0°, q2 ≈ 90°.
#[test]
fn test_2dof_planar_arm_known_solution() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let result = solver.solve(&q0, target);

    println!("  q1 = {:.6} rad ({:.2}°)", result.q[0], result.q[0].to_degrees());
    println!("  q2 = {:.6} rad ({:.2}°)", result.q[1], result.q[1].to_degrees());

    assert!(
        result.q[0].abs() < 1e-2,
        "Esperado q1 ≈ 0, got {}",
        result.q[0]
    );
    assert!(
        (result.q[1] - PI / 2.0).abs() < 1e-2,
        "Esperado q2 ≈ π/2, got {}",
        result.q[1]
    );
    assert!(result.status.is_converged(), "IK debe converger");
}

/// 4. CONSISTENCIA FK: después de IK, FK(position(q)) ≈ target.
#[test]
fn test_fk_ik_consistency() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk.clone(), ee, 500, 1e-6, 0.5);

    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(1.0, 1.0, 0.0);
    let result = solver.solve(&q0, target);

    // FK desde la solución de IK
    let fk_result = fk.evaluate(&result.q);
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

/// 5. VERIFICACIÓN DEL JACOBIANO: geométrico vs. numérico.
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

/// 6. CASO EXTREMADAMENTE SIMPLE: 1-DOF.
///
/// L = 1, target (0, 1, 0).
/// Solución analítica: θ = π/2.
#[test]
fn test_1dof_reaches_known_target() {
    let (fk, ee) = build_1dof_arm(1.0);
    let solver = JacobianTransposeSolver::new(fk, ee, 100, 1e-6, 0.5);

    let q0 = vec![0.0];
    let target = Vector3::new(0.0, 1.0, 0.0);
    let result = solver.solve(&q0, target);

    println!("  θ = {:.6} rad ({:.2}°)", result.q[0], result.q[0].to_degrees());

    assert!(
        (result.q[0] - PI / 2.0).abs() < 1e-3,
        "Esperado θ ≈ π/2, got {}",
        result.q[0]
    );
    assert!(result.status.is_converged(), "IK debe converger en 1-DOF");
    assert!(
        result.iterations <= 100,
        "No debe exceder max_iters, usó {}",
        result.iterations
    );
}