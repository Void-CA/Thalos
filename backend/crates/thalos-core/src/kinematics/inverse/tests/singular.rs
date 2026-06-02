use super::*;

// ═══════════════════════════════════════════════════════════════════════
// FASE 2: SINGULARIDADES
// ═══════════════════════════════════════════════════════════════════════

/// 10. SINGULARIDAD BLOQUEA CONVERGENCIA: un target puramente radial
///     desde q=[0,0] (brazo extendido) produce J^T · e = 0 → el error
///     no decrece → el solver se queda atascado. Desde una configuración
///     no-singular el mismo target es alcanzable sin problemas.
///
///     Esto demuestra que la singularidad en el borde del workspace
///     impide el progreso del JT: no puede modificar la extensión
///     radial porque la columna X del Jacobiano es [0, 0]ᵀ.
#[test]
fn test_singular_radial_error_blocks_convergence() {
    let (fk, ee) = build_2dof_planar_arm();
    // Target en el eje X (puramente radial desde q=[0,0])
    let target = Vector3::new(1.5, 0.0, 0.0);

    // Resolver desde singular: J^T · e = 0 → stuck
    let solver_sing = JacobianTransposeSolver::new(fk.clone(), ee.clone(), 100, 1e-6, 0.5);
    let result_singular = solver_sing.solve(&[0.0, 0.0], target);

    // Resolver desde no-singular: debe converger
    let solver_nonsing = JacobianTransposeSolver::new(fk, ee, 100, 1e-6, 0.5);
    let result_nonsingular = solver_nonsing.solve(&[PI / 4.0, PI / 4.0], target);

    println!(
        "  singular (q=[0,0]):       {} iter, error = {:.2e}, q = [{:.4}, {:.4}], status={:?}",
        result_singular.iterations, result_singular.final_error,
        result_singular.q[0], result_singular.q[1],
        result_singular.status
    );
    println!(
        "  no-singular (q=[π/4,π/4]): {} iter, error = {:.2e}, q = [{:.4}, {:.4}], status={:?}",
        result_nonsingular.iterations, result_nonsingular.final_error,
        result_nonsingular.q[0], result_nonsingular.q[1],
        result_nonsingular.status
    );

    // El singular NO debe converger (error radial puro → J^T·e = 0)
    assert_eq!(
        result_singular.status,
        IKStatus::MaxIterations,
        "Singular con error radial no debe converger"
    );

    // El error del singular debe ser ≈ error inicial (no progresó)
    let initial_error = (target - Vector3::new(2.0, 0.0, 0.0)).magnitude();
    assert!(
        (result_singular.final_error - initial_error).abs() < 1e-12,
        "Error singular ({:.4}) debe ser ≈ error inicial ({:.4})",
        result_singular.final_error,
        initial_error
    );

    // El no-singular SÍ debe converger
    assert!(
        result_nonsingular.status.is_converged(),
        "No-singular debe converger, status={:?}",
        result_nonsingular.status
    );
}

/// 11. HISTORIAL MONOTÓNICO EN SINGULARIDAD: el error nunca debe
///     aumentar (dentro de tolerancia numérica) incluso partiendo
///     de una configuración singular, porque JT es descenso por
///     gradiente del error cuadrático.
#[test]
fn test_singular_config_error_history_monotonic() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5)
        .with_history(true);

    let target = Vector3::new(1.2, 0.5, 0.0);
    let result = solver.solve(&[0.0, 0.0], target);

    assert!(
        result.status.is_converged(),
        "Debe converger: status={:?}",
        result.status
    );

    let history = result
        .error_history
        .expect("with_history(true) debe registrar historial");

    // El error nunca debe aumentar (tolerancia 1e-12 para punto flotante)
    for i in 0..history.len() - 1 {
        assert!(
            history[i + 1] <= history[i] + 1e-12,
            "Error aumentó en iteración {}: {:.6e} → {:.6e}",
            i,
            history[i],
            history[i + 1]
        );
    }

    println!(
        "  Historial monotónico verificado ({} iteraciones)",
        history.len()
    );
}

/// 12. SIN OSCILACIÓN EN SINGULARIDAD: la magnitud del cambio del
///     error entre iteraciones consecutivas debe decrecer a medida
///     que el solver converge (el gradiente se achica).
#[test]
fn test_singular_config_no_oscillation() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5)
        .with_history(true);

    let target = Vector3::new(1.2, 0.5, 0.0);
    let result = solver.solve(&[0.0, 0.0], target);

    assert!(
        result.status.is_converged(),
        "Debe converger: status={:?}",
        result.status
    );

    let history = result
        .error_history
        .expect("with_history(true) debe registrar historial");

    // Calcular diferencias consecutivas: diff[i] = error[i] - error[i+1]
    // (positivo porque el error decrece)
    let diffs: Vec<f64> = history
        .windows(2)
        .map(|w| w[0] - w[1])
        .collect();

    // El solver debe tener al menos unos pocos pasos
    assert!(
        diffs.len() >= 10,
        "Muy pocas iteraciones ({}) para evaluar oscilación",
        diffs.len()
    );

    // La diferencia media del último tercio debe ser menor que la del
    // primer tercio (el gradiente se achica al acercarse al óptimo).
    let n = diffs.len();
    let first_third: &[f64] = &diffs[..n / 3];
    let last_third: &[f64] = &diffs[2 * n / 3..];

    let mean_first: f64 = first_third.iter().sum::<f64>() / first_third.len() as f64;
    let mean_last: f64 = last_third.iter().sum::<f64>() / last_third.len() as f64;

    println!(
        "  diff medio (1er tercio) = {:.6e}, diff medio (3er tercio) = {:.6e}",
        mean_first, mean_last
    );

    // Las diferencias medias deben decrecer (último tercio << primer tercio)
    // Usamos un factor generoso (10×) porque la convergencia de JT en
    // régimen lineal no siempre es perfectamente exponencial.
    assert!(
        mean_last < mean_first * 0.5,
        "Las diferencias de error no decrecen lo suficiente: \
         1er tercio={:.6e}, 3er tercio={:.6e}",
        mean_first,
        mean_last
    );
}
