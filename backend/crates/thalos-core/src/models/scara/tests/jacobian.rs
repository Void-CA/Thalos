use crate::prelude::*;
use crate::models::factories::create_scara_robot;

// Helper para crear un robot SCARA y sus componentes
fn setup_scara_robot() -> (NumericalJacobian, ForwardKinematics, crate::spatial::frame::FrameId) {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);
    let end_effector = robot.end_effector().clone();
    let fk = ForwardKinematics::new(robot);
    let jacobian = NumericalJacobian::new(fk.clone(), end_effector.clone());
    (jacobian, fk, end_effector)
}

#[test]
fn dimensions_are_correct() {
    let (jacobian, _, _) = setup_scara_robot();
    
    let q = [0.0, 0.0, 0.0, 0.0];
    let j = jacobian.evaluate(&q);
    
    assert_eq!(j.nrows(), 3, "SCARA Jacobian should have 3 rows (x, y, z)");
    assert_eq!(j.ncols(), 4, "SCARA Jacobian should have 4 columns for 4 joints");
}

#[test]
fn predicts_small_motion() {
    let (jacobian, fk, end_effector) = setup_scara_robot();
    
    let q = [0.0, 0.0, 0.0, 0.0];
    let j = jacobian.evaluate(&q);
    
    // Probar cada junta individualmente
    let test_cases = [
        (0, 1e-4, "first revolute joint"),      // q1
        (1, 1e-4, "second revolute joint"),     // q2
        (2, 1e-4, "prismatic joint"),           // d3
        (3, 1e-4, "wrist revolute joint"),      // q4
    ];
    
    for (joint_idx, delta, name) in test_cases {
        let mut dq = vec![0.0, 0.0, 0.0, 0.0];
        dq[joint_idx] = delta;
        
        // Predicted motion
        let dx_pred = j.matrix() * nalgebra::DVector::from_vec(dq.clone());
        
        // Real FK motion
        let q2 = [
            q[0] + dq[0],
            q[1] + dq[1],
            q[2] + dq[2],
            q[3] + dq[3],
        ];
        
        let fk1 = fk.evaluate(&q);
        let fk2 = fk.evaluate(&q2);
        
        let p1 = fk1
            .pose(&end_effector)
            .unwrap()
            .transform()
            .translation;
        
        let p2 = fk2
            .pose(&end_effector)
            .unwrap()
            .transform()
            .translation;
        
        let dx_real = vec![
            p2.x - p1.x,
            p2.y - p1.y,
            p2.z - p1.z,
        ];
        
        assert!(
            (dx_pred[0] - dx_real[0]).abs() < 1e-5,
            "X motion mismatch for {}: predicted {}, real {}",
            name, dx_pred[0], dx_real[0]
        );
        
        assert!(
            (dx_pred[1] - dx_real[1]).abs() < 1e-5,
            "Y motion mismatch for {}: predicted {}, real {}",
            name, dx_pred[1], dx_real[1]
        );
        
        assert!(
            (dx_pred[2] - dx_real[2]).abs() < 1e-5,
            "Z motion mismatch for {}: predicted {}, real {}",
            name, dx_pred[2], dx_real[2]
        );
    }
}

#[test]
fn at_zero_configuration() {
    let (jacobian, _, _) = setup_scara_robot();
    
    let q = [0.0, 0.0, 0.0, 0.0];
    let j = jacobian.evaluate(&q);
    
    // En configuración cero (brazos extendidos en X, Z=0, muñeca sin rotar):
    // L1=1, L2=1, posición final en (2, 0, 0)
    //
    // Juntas revolutas (1 y 2): afectan XY igual que planar 2R
    // ∂x/∂θ1 = -2, ∂x/∂θ2 = -1
    // ∂y/∂θ1 = 0,  ∂y/∂θ2 = 0
    //
    // Junta prismática (3): solo afecta Z
    // ∂z/∂d3 = 1
    //
    // Junta muñeca (4): NO afecta posición (solo orientación)
    // ∂x/∂θ4 = 0, ∂y/∂θ4 = 0, ∂z/∂θ4 = 0
    
    // Revolute joints (XY plane)
    let dx_dq1 = j[(0, 0)];
    let dx_dq2 = j[(0, 1)];
    let dy_dq1 = j[(1, 0)];
    let dy_dq2 = j[(1, 1)];
    
    assert!(
        dx_dq1.abs() < 1e-6,
        "dx/dθ1 should be 0 at zero config, got {}",
        dx_dq1
    );

    assert!(
        dx_dq2.abs() < 1e-6,
        "dx/dθ2 should be 0 at zero config, got {}",
        dx_dq2
    );

    assert!(
        (dy_dq1 - 2.0).abs() < 1e-4,
        "dy/dθ1 should be 2.0 at zero config, got {}",
        dy_dq1
    );

    assert!(
        (dy_dq2 - 1.0).abs() < 1e-4,
        "dy/dθ2 should be 1.0 at zero config, got {}",
        dy_dq2
    );
    
    // Prismatic joint (Z axis)
    let dz_dd3 = j[(2, 2)];
    assert!(
        (dz_dd3 - 1.0).abs() < 1e-4,
        "dz/dd3 should be 1.0 at zero config, got {}",
        dz_dd3
    );
    
    // Wrist joint (should not affect position)
    let dx_dq4 = j[(0, 3)];
    let dy_dq4 = j[(1, 3)];
    let dz_dq4 = j[(2, 3)];
    
    assert!(
        dx_dq4.abs() < 1e-6,
        "dx/dθ4 should be 0 (wrist rotation doesn't affect position), got {}",
        dx_dq4
    );
    assert!(
        dy_dq4.abs() < 1e-6,
        "dy/dθ4 should be 0 (wrist rotation doesn't affect position), got {}",
        dy_dq4
    );
    assert!(
        dz_dq4.abs() < 1e-6,
        "dz/dθ4 should be 0, got {}",
        dz_dq4
    );
}

#[test]
fn prismatic_joint_only_affects_z() {
    let (jacobian, _, _) = setup_scara_robot();
    
    // Probar en diferentes configuraciones que la junta prismática solo afecta Z
    let test_configs = [
        [0.0, 0.0, 0.0, 0.0],
        [PI/4.0, 0.0, 0.5, 0.0],
        [PI/2.0, PI/4.0, -0.3, PI/3.0],
    ];
    
    for q in test_configs {
        let j = jacobian.evaluate(&q);
        
        // La columna de la junta prismática (índice 2) debería tener:
        // dx/dd3 = 0, dy/dd3 = 0, dz/dd3 = 1
        let dx_dd3 = j[(0, 2)];
        let dy_dd3 = j[(1, 2)];
        let dz_dd3 = j[(2, 2)];
        
        assert!(
            dx_dd3.abs() < 1e-6,
            "Prismatic joint should not affect X at q={:?}, got {}",
            q, dx_dd3
        );
        assert!(
            dy_dd3.abs() < 1e-6,
            "Prismatic joint should not affect Y at q={:?}, got {}",
            q, dy_dd3
        );
        assert!(
            (dz_dd3 - 1.0).abs() < 1e-4,
            "Prismatic joint should give unit velocity in Z at q={:?}, got {}",
            q, dz_dd3
        );
    }
}

#[test]
fn wrist_joint_does_not_affect_position() {
    let (jacobian, _, _) = setup_scara_robot();
    
    // La muñeca (junta 4) es rotacional en Z, no debería afectar posición
    let test_configs = [
        [0.0, 0.0, 0.0, 0.0],
        [PI/4.0, PI/6.0, 0.3, PI/2.0],
        [PI/3.0, -PI/4.0, -0.2, PI/4.0],
    ];
    
    for q in test_configs {
        let j = jacobian.evaluate(&q);
        
        let dx_dq4 = j[(0, 3)];
        let dy_dq4 = j[(1, 3)];
        let dz_dq4 = j[(2, 3)];
        
        assert!(
            dx_dq4.abs() < 1e-6,
            "Wrist rotation should not affect X at q={:?}, got {}",
            q, dx_dq4
        );
        assert!(
            dy_dq4.abs() < 1e-6,
            "Wrist rotation should not affect Y at q={:?}, got {}",
            q, dy_dq4
        );
        assert!(
            dz_dq4.abs() < 1e-6,
            "Wrist rotation should not affect Z at q={:?}, got {}",
            q, dz_dq4
        );
    }
}

#[test]
fn at_ninety_degrees_first_joint() {
    let (jacobian, _, _) = setup_scara_robot();
    
    let q = [PI / 2.0, 0.0, 0.0, 0.0];
    let j = jacobian.evaluate(&q);
    
    // Para θ1=90°, θ2=0:
    // ∂x/∂θ1 = -1 - 1 = -2
    // ∂x/∂θ2 = -1
    // ∂y/∂θ1 = 0
    // ∂y/∂θ2 = 0
    
    let dx_dq1 = j[(0, 0)];
    let dx_dq2 = j[(0, 1)];
    let dy_dq1 = j[(1, 0)];
    let dy_dq2 = j[(1, 1)];
    
    assert!(
        (dx_dq1 + 2.0).abs() < 1e-4,
        "dx/dθ1 should be -2.0, got {}",
        dx_dq1
    );
    assert!(
        (dx_dq2 + 1.0).abs() < 1e-4,
        "dx/dθ2 should be -1.0, got {}",
        dx_dq2
    );
    assert!(
        dy_dq1.abs() < 1e-6,
        "dy/dθ1 should be 0, got {}",
        dy_dq1
    );
    assert!(
        dy_dq2.abs() < 1e-6,
        "dy/dθ2 should be 0, got {}",
        dy_dq2
    );
}

#[test]
fn approximates_velocity_correctly() {
    let (jacobian, fk, end_effector) = setup_scara_robot();
    
    let q = [PI / 4.0, PI / 6.0, 0.3, PI / 3.0];
    let q_dot = [0.2, 0.1, 0.05, 0.15];  // Velocidades articulares
    
    let j = jacobian.evaluate(&q);
    
    // Calcular velocidad espacial predicha: v = J * q_dot
    let v_pred_x = j[(0, 0)] * q_dot[0] + j[(0, 1)] * q_dot[1] 
                    + j[(0, 2)] * q_dot[2] + j[(0, 3)] * q_dot[3];
    let v_pred_y = j[(1, 0)] * q_dot[0] + j[(1, 1)] * q_dot[1] 
                    + j[(1, 2)] * q_dot[2] + j[(1, 3)] * q_dot[3];
    let v_pred_z = j[(2, 0)] * q_dot[0] + j[(2, 1)] * q_dot[1] 
                    + j[(2, 2)] * q_dot[2] + j[(2, 3)] * q_dot[3];
    
    // Verificar con diferencia finita
    let dt = 1e-5;
    let q_next = [
        q[0] + q_dot[0] * dt,
        q[1] + q_dot[1] * dt,
        q[2] + q_dot[2] * dt,
        q[3] + q_dot[3] * dt,
    ];
    
    let p_current = fk.evaluate(&q)
        .pose(&end_effector)
        .unwrap()
        .transform()
        .translation;
    
    let p_next = fk.evaluate(&q_next)
        .pose(&end_effector)
        .unwrap()
        .transform()
        .translation;
    
    let v_actual_x = (p_next.x - p_current.x) / dt;
    let v_actual_y = (p_next.y - p_current.y) / dt;
    let v_actual_z = (p_next.z - p_current.z) / dt;
    
    assert!(
        (v_pred_x - v_actual_x).abs() < 1e-4,
        "X velocity mismatch: predicted {}, actual {}",
        v_pred_x, v_actual_x
    );
    assert!(
        (v_pred_y - v_actual_y).abs() < 1e-4,
        "Y velocity mismatch: predicted {}, actual {}",
        v_pred_y, v_actual_y
    );
    assert!(
        (v_pred_z - v_actual_z).abs() < 1e-4,
        "Z velocity mismatch: predicted {}, actual {}",
        v_pred_z, v_actual_z
    );
}

#[test]
fn determinant_indicates_singularity() {
    let (jacobian, _, _) = setup_scara_robot();
    
    // Para SCARA, las singularidades ocurren en el plano XY cuando:
    // 1) Brazos completamente extendidos (θ2 = 0)
    // 2) Brazos completamente plegados (θ2 = ±π)
    
    // Configuración singular en XY: brazos extendidos
    let q_singular_xy = [0.0, 0.0, 0.0, 0.0];
    let j_singular = jacobian.evaluate(&q_singular_xy);
    
    // Tomamos la submatriz 2x2 de las juntas revolutas (primeras 2 columnas, filas X,Y)
    let det_singular_xy = j_singular[(0, 0)] * j_singular[(1, 1)] 
                            - j_singular[(0, 1)] * j_singular[(1, 0)];
    
    // Configuración no singular en XY
    let q_normal = [PI / 3.0, PI / 4.0, 0.0, 0.0];
    let j_normal = jacobian.evaluate(&q_normal);
    let det_normal_xy = j_normal[(0, 0)] * j_normal[(1, 1)] 
                        - j_normal[(0, 1)] * j_normal[(1, 0)];
    
    // El determinante debería ser significativamente menor en singularidad
    assert!(
        det_singular_xy.abs() < det_normal_xy.abs() * 0.1,
        "XY determinant near singularity ({}) should be much smaller than normal ({})",
        det_singular_xy, det_normal_xy
    );
    
    // Otra singularidad: brazos plegados (θ2 = π)
    let q_folded = [0.0, PI, 0.0, 0.0];
    let j_folded = jacobian.evaluate(&q_folded);
    let det_folded_xy = j_folded[(0, 0)] * j_folded[(1, 1)] 
                        - j_folded[(0, 1)] * j_folded[(1, 0)];
    
    assert!(
        det_folded_xy.abs() < 1e-4,
        "XY determinant at folded config should be near zero, got {}",
        det_folded_xy
    );
}

#[test]
fn reconstruction_from_motion() {
    let (jacobian, fk, end_effector) = setup_scara_robot();
    
    // Probar múltiples configuraciones
    let test_configs = [
        ([0.0, 0.0, 0.0, 0.0], [0.1, 0.05, 0.02, 0.03]),
        ([PI/4.0, 0.0, 0.2, 0.0], [0.2, 0.1, 0.03, 0.05]),
        ([PI/3.0, PI/6.0, -0.1, PI/4.0], [0.15, 0.2, 0.04, 0.1]),
        ([PI/2.0, -PI/4.0, 0.5, PI/3.0], [0.1, 0.15, 0.05, 0.2]),
    ];
    
    let dt = 1e-5;
    
    for (q, q_dot) in test_configs {
        let j = jacobian.evaluate(&q);
        
        // Velocidad predicha
        let v_pred_x = (0..4).map(|i| j[(0, i)] * q_dot[i]).sum::<f64>();
        let v_pred_y = (0..4).map(|i| j[(1, i)] * q_dot[i]).sum::<f64>();
        let v_pred_z = (0..4).map(|i| j[(2, i)] * q_dot[i]).sum::<f64>();
        
        // Velocidad real
        let q_next = [
            q[0] + q_dot[0] * dt,
            q[1] + q_dot[1] * dt,
            q[2] + q_dot[2] * dt,
            q[3] + q_dot[3] * dt,
        ];
        
        let p_curr = fk.evaluate(&q)
            .pose(&end_effector)
            .unwrap()
            .transform()
            .translation;
        
        let p_next = fk.evaluate(&q_next)
            .pose(&end_effector)
            .unwrap()
            .transform()
            .translation;
        
        let v_actual_x = (p_next.x - p_curr.x) / dt;
        let v_actual_y = (p_next.y - p_curr.y) / dt;
        let v_actual_z = (p_next.z - p_curr.z) / dt;
        
        let error_x = (v_pred_x - v_actual_x).abs();
        let error_y = (v_pred_y - v_actual_y).abs();
        let error_z = (v_pred_z - v_actual_z).abs();
        
        assert!(
            error_x < 1e-4,
            "X velocity error too large at q={:?}: predicted {}, actual {}",
            q, v_pred_x, v_actual_x
        );
        assert!(
            error_y < 1e-4,
            "Y velocity error too large at q={:?}: predicted {}, actual {}",
            q, v_pred_y, v_actual_y
        );
        assert!(
            error_z < 1e-4,
            "Z velocity error too large at q={:?}: predicted {}, actual {}",
            q, v_pred_z, v_actual_z
        );
    }
}

#[test]
fn maps_velocities_linearly() {
    let (jacobian, _, _) = setup_scara_robot();
    
    let q = [PI / 4.0, PI / 6.0, 0.3, PI / 3.0];
    let j = jacobian.evaluate(&q);
    
    // Probar linealidad: J*(a*v1 + b*v2) = a*J*v1 + b*J*v2
    let v1 = [0.1, 0.2, 0.05, 0.15];
    let v2 = [0.05, 0.15, 0.03, 0.1];
    let a = 2.0;
    let b = 3.0;
    
    let jv_combined = {
        let v_combined = [
            a * v1[0] + b * v2[0],
            a * v1[1] + b * v2[1],
            a * v1[2] + b * v2[2],
            a * v1[3] + b * v2[3],
        ];
        let jv_x = (0..4).map(|i| j[(0, i)] * v_combined[i]).sum::<f64>();
        let jv_y = (0..4).map(|i| j[(1, i)] * v_combined[i]).sum::<f64>();
        let jv_z = (0..4).map(|i| j[(2, i)] * v_combined[i]).sum::<f64>();
        (jv_x, jv_y, jv_z)
    };
    
    let jv1 = {
        let jv_x = (0..4).map(|i| j[(0, i)] * v1[i]).sum::<f64>();
        let jv_y = (0..4).map(|i| j[(1, i)] * v1[i]).sum::<f64>();
        let jv_z = (0..4).map(|i| j[(2, i)] * v1[i]).sum::<f64>();
        (jv_x, jv_y, jv_z)
    };
    
    let jv2 = {
        let jv_x = (0..4).map(|i| j[(0, i)] * v2[i]).sum::<f64>();
        let jv_y = (0..4).map(|i| j[(1, i)] * v2[i]).sum::<f64>();
        let jv_z = (0..4).map(|i| j[(2, i)] * v2[i]).sum::<f64>();
        (jv_x, jv_y, jv_z)
    };
    
    let jv_linear = (
        a * jv1.0 + b * jv2.0,
        a * jv1.1 + b * jv2.1,
        a * jv1.2 + b * jv2.2,
    );
    
    assert!(
        (jv_combined.0 - jv_linear.0).abs() < 1e-10,
        "Linearity fails in X: combined {}, linear {}",
        jv_combined.0, jv_linear.0
    );
    assert!(
        (jv_combined.1 - jv_linear.1).abs() < 1e-10,
        "Linearity fails in Y: combined {}, linear {}",
        jv_combined.1, jv_linear.1
    );
    assert!(
        (jv_combined.2 - jv_linear.2).abs() < 1e-10,
        "Linearity fails in Z: combined {}, linear {}",
        jv_combined.2, jv_linear.2
    );
}

#[test]
fn independent_xy_and_z_motions() {
    let (jacobian, _, _) = setup_scara_robot();
    
    let q = [PI / 4.0, PI / 6.0, 0.3, PI / 3.0];
    let j = jacobian.evaluate(&q);
    
    // Verificar que las juntas revolutas (0,1,3) no afectan Z
    for joint_idx in [0, 1, 3] {
        let dz_dq = j[(2, joint_idx)];
        assert!(
            dz_dq.abs() < 1e-6,
            "Revolute joint {} should not affect Z, got {}",
            joint_idx, dz_dq
        );
    }
    
    // Verificar que la junta prismática (2) solo afecta Z
    let dx_dd3 = j[(0, 2)];
    let dy_dd3 = j[(1, 2)];
    let dz_dd3 = j[(2, 2)];
    
    assert!(
        dx_dd3.abs() < 1e-6,
        "Prismatic joint should not affect X, got {}",
        dx_dd3
    );
    assert!(
        dy_dd3.abs() < 1e-6,
        "Prismatic joint should not affect Y, got {}",
        dy_dd3
    );
    assert!(
        (dz_dd3 - 1.0).abs() < 1e-4,
        "Prismatic joint should give unit Z velocity, got {}",
        dz_dd3
    );
}
