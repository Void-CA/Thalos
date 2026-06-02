use super::*;

// ═══════════════════════════════════════════════════════════════════════
// FASE 1: OBJETIVOS INALCANZABLES
// ═══════════════════════════════════════════════════════════════════════

/// 7. TARGET FUERA DEL WORKSPACE: debe devolver MaxIterations con
///    final_error ≈ distancia más allá del alcance máximo.
///
/// Brazo 2R con L1=L2=1: reach max = 2.
/// Target (3, 0, 0) está a 1 unidad más allá del workspace.
#[test]
fn test_unreachable_target_returns_max_iterations() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5);

    // q0 = [0, 0]: brazo completamente extendido en X.
    // El error (1, 0, 0) es puramente radial → el Jacobiano es singular
    // en esa dirección (J^T · e = 0) → el solver se queda quieto con
    // error = 1.0 durante todas las iteraciones. Esto nos da un test
    // determinista del comportamiento con target inalcanzable.
    let q0 = vec![0.0, 0.0];
    let target = Vector3::new(3.0, 0.0, 0.0);
    let result = solver.solve(&q0, target);

    // No debe converger (target fuera del workspace)
    assert_eq!(
        result.status,
        IKStatus::MaxIterations,
        "Unreachable target debe dar MaxIterations, status={:?}, error={:.4}",
        result.status,
        result.final_error
    );

    // reach_max = L1 + L2 = 2, target_distance = 3 → min_error = 1
    // Con q0=[0,0] el solver no se mueve → final_error = 1.0 exacto
    let expected_min_error = 1.0;
    assert!(
        (result.final_error - expected_min_error).abs() < 1e-12,
        "final_error ({:.4}) debe ser exactamente la distancia inalcanzable ({:.4}) \
            cuando q0 = [0,0] (singular)",
        result.final_error,
        expected_min_error
    );

    // Verificar que el solver no modificó q (singularidad → dq = 0)
    assert_eq!(result.q[0], 0.0, "q1 no debe cambiar desde q0 = [0,0]");
    assert_eq!(result.q[1], 0.0, "q2 no debe cambiar desde q0 = [0,0]");

    // Verificar que NO hay NaN ni Inf en la solución
    for (i, &q_val) in result.q.iter().enumerate() {
        assert!(
            q_val.is_finite(),
            "q[{}] debe ser finito, got {}",
            i,
            q_val
        );
    }
}

/// 8. MÚLTIPLES TARGETS INALCANZABLES: verificar que el error final
///    escala con la distancia más allá del workspace.
#[test]
fn test_unreachable_target_error_equals_distance() {
    let (fk, ee) = build_2dof_planar_arm();
    let solver = JacobianTransposeSolver::new(fk, ee, 500, 1e-6, 0.5);

    let max_reach = 2.0;

    // Targets sobre el eje X positivo (radiales desde q=[0,0]).
    // El error es puramente en X → J^T · e = 0 → solver no se mueve,
    // final_error queda exacto = distance - max_reach.
    let test_cases = [
        (Vector3::new(3.0, 0.0, 0.0), 3.0),   // reach 2 → error 1.0
        (Vector3::new(4.0, 0.0, 0.0), 4.0),   // reach 2 → error 2.0
        (Vector3::new(2.5, 0.0, 0.0), 2.5),   // reach 2 → error 0.5
    ];

    for (target, target_distance) in test_cases {
        // q0 = [0,0]: brazo extendido en X, Jacobiano singular en esa
        // dirección radial → solver no se mueve, error queda exacto.
        let result = solver.solve(&[0.0, 0.0], target);

        assert_eq!(
            result.status,
            IKStatus::MaxIterations,
            "Target a distancia {:.1} debe dar MaxIterations",
            target_distance
        );

        let expected_min_error = target_distance - max_reach;
        assert!(
            (result.final_error - expected_min_error).abs() < 1e-12,
            "final_error ({:.4}) debe ser exactamente {} para target a distancia {:.1}",
            result.final_error,
            expected_min_error,
            target_distance
        );

        // El solver no modificó q por estar en singularidad
        assert_eq!(result.q[0], 0.0, "q1 no debe cambiar");
        assert_eq!(result.q[1], 0.0, "q2 no debe cambiar");

        // Todos los q deben ser finitos
        for &q_val in &result.q {
            assert!(q_val.is_finite(), "q debe ser finito, got {}", q_val);
        }
    }
}

/// 9. ROBUSTEZ: targets inalcanzables no deben producir explosión
///    numérica aunque el solver se acerque a singularidades.
#[test]
fn test_unreachable_target_does_not_explode() {
    let (fk, ee) = build_2dof_planar_arm();

    // Probar múltiples configuraciones iniciales
    let start_configs = [
        vec![0.0, 0.0],    // singular
        vec![1.0, 0.5],    // lejano
        vec![-0.8, 1.2],   // negativo
        vec![PI, -0.5],    // extremo
    ];

    let targets = [
        Vector3::new(10.0, 0.0, 0.0),  // muy fuera
        Vector3::new(0.0, 10.0, 0.0),  // muy fuera en Y
        Vector3::new(5.0, 5.0, 0.0),   // fuera en diagonal
    ];

    for q0 in &start_configs {
        for &target in &targets {
            let solver = JacobianTransposeSolver::new(
                fk.clone(),
                ee.clone(),
                200,
                1e-6,
                0.5,
            );
            let result = solver.solve(q0, target);

            // No debe explotar
            assert_eq!(
                result.status,
                IKStatus::MaxIterations,
                "Target inalcanzable debe dar MaxIterations, no converger"
            );

            // No debe producir infinitos
            for &q_val in &result.q {
                assert!(
                    q_val.is_finite(),
                    "q debe ser finito para q0={:?}, target=({},{}), got {}",
                    q0, target.x, target.y, q_val
                );
            }

            assert!(
                result.final_error.is_finite(),
                "final_error debe ser finito, got {}",
                result.final_error
            );
        }
    }
}
