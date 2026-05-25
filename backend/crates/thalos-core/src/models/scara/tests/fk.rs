use crate::prelude::*;
use crate::models::factories::create_scara_robot;

#[test]
fn returns_four_poses() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let fk = ForwardKinematics::new(robot);

    // Configuración: todas las juntas en cero
    let result = fk.evaluate(&[0.0, 0.0, 0.0, 0.0]);

    let frames: Vec<_> = result.frames().collect();

    assert_eq!(
        frames.len(),
        5,  // 4 segmentos = 4 frames móviles + world frame? Ajusta según tu implementación
        "SCARA should generate exactly 5 poses (one per joint + world pose)",
    );
}

#[test]
fn zero_configuration_places_end_effector_at_2_0_0() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=0, q2=0, d3=0, q4=0
    let result = fk.evaluate(&[0.0, 0.0, 0.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 2.0).abs() < EPS
            && t.y.abs() < EPS
            && t.z.abs() < EPS,
        "SCARA at zero config should be at (2, 0, 0), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn first_joint_90_deg_places_end_effector_at_0_2_0() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=90°, q2=0, d3=0, q4=0
    let result = fk.evaluate(&[PI / 2.0, 0.0, 0.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        t.x.abs() < EPS
            && (t.y - 2.0).abs() < EPS
            && t.z.abs() < EPS,
        "SCARA with first joint at 90° should be at (0, 2, 0), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn folded_configuration_places_end_effector_at_1_1_0() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=90°, q2=-90°, d3=0, q4=0
    // Link1: (0,1)
    // Link2: (1,1) - el segundo brazo rota -90° relativo, apuntando hacia la derecha
    let result = fk.evaluate(&[PI / 2.0, -PI / 2.0, 0.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 1.0).abs() < EPS
            && (t.y - 1.0).abs() < EPS
            && t.z.abs() < EPS,
        "Folded SCARA should be at (1, 1, 0), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn prismatic_joint_moves_end_effector_vertically() {
    let robot = create_scara_robot(1.0, 1.0, -2.0, 2.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=0, q2=0, d3=0.5, q4=0
    let result = fk.evaluate(&[0.0, 0.0, 0.5, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 2.0).abs() < EPS
            && t.y.abs() < EPS
            && (t.z - 0.5).abs() < EPS,
        "Prismatic joint at 0.5 should place end effector at z=0.5, got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn prismatic_joint_negative_movement() {
    let robot = create_scara_robot(1.0, 1.0, -2.0, 2.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=0, q2=0, d3=-1.0, q4=0
    let result = fk.evaluate(&[0.0, 0.0, -1.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 2.0).abs() < EPS
            && t.y.abs() < EPS
            && (t.z + 1.0).abs() < EPS,
        "Prismatic joint at -1.0 should place end effector at z=-1.0, got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn wrist_rotation_affects_orientation_but_not_position() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=0, q2=0, d3=0, q4=90°
    let result = fk.evaluate(&[0.0, 0.0, 0.0, PI / 2.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;
    let orientation = pose.transform().rotation;

    // La posición no debe cambiar por la rotación de la muñeca
    assert!(
        (t.x - 2.0).abs() < EPS
            && t.y.abs() < EPS
            && t.z.abs() < EPS,
        "Wrist rotation should not affect position at (2,0,0), got ({}, {}, {})",
        t.x, t.y, t.z
    );

    // Verificar orientación (debería tener rotación de 90° en Z)
    let euler = orientation.to_euler();
    assert!(
        (euler.2 - PI / 2.0).abs() < EPS, // Asumiendo orden ZYX
        "Wrist should be rotated 90° in Z, got {} rad",
        euler.2
    );
}

#[test]
fn combined_motions_accumulate_correctly() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1=45°, q2=45°, d3=0.3, q4=90°
    // Esto prueba la acumulación de todas las transformaciones
    let result = fk.evaluate(&[
        PI / 4.0,    // 45°
        PI / 4.0,    // 45° más = 90° total para el brazo
        0.3,         // Subir 0.3
        PI / 2.0     // Muñeca rotada 90°
    ]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;
    
    // Cálculo esperado:
    // Posición XY = (1*cos45° + 1*cos90°, 1*sin45° + 1*sin90°)
    // = (0.7071 + 0, 0.7071 + 1) = (0.7071, 1.7071)
    let expected_x = 1.0 * (PI / 4.0).cos() + 1.0 * (PI / 2.0).cos();
    let expected_y = 1.0 * (PI / 4.0).sin() + 1.0 * (PI / 2.0).sin();
    let expected_z = 0.3;

    assert!(
        (t.x - expected_x).abs() < EPS
            && (t.y - expected_y).abs() < EPS
            && (t.z - expected_z).abs() < EPS,
        "Combined motion SCARA should be at ({:.4}, {:.4}, {:.4}), got ({:.4}, {:.4}, {:.4})",
        expected_x, expected_y, expected_z,
        t.x, t.y, t.z
    );

    // Verificar orientación final (q1+q2+q4 = 45°+45°+90° = 180°)
    let orientation = pose.transform().rotation;
    let euler = orientation.to_euler();
    assert!(
        (euler.2 - PI).abs() < EPS,
        "Final orientation should be 180°, got {} rad",
        euler.2
    );
}

#[test]
fn workspace_limits_test() {
    let robot = create_scara_robot(1.0, 1.0, -2.0, 2.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // Probar configuración en el límite del workspace
    // Brazos completamente extendidos en X positiva
    let result = fk.evaluate(&[0.0, 0.0, 2.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();
    let t = &pose.transform().translation;

    assert!(
        (t.x - 2.0).abs() < EPS
            && t.y.abs() < EPS
            && (t.z - 2.0).abs() < EPS,
        "Extended SCARA at max Z should be at (2, 0, 2), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn position_independent_of_wrist_rotation() {
    let robot = create_scara_robot(1.0, 1.0, -1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // Configuración base: brazos extendidos en X
    let base_config = [0.0, 0.0, 0.5, 0.0];
    let rotated_config = [0.0, 0.0, 0.5, PI / 2.0];

    let result_base = fk.evaluate(&base_config);
    let result_rotated = fk.evaluate(&rotated_config);

    let pose_base = result_base.pose(&end_effector).unwrap();
    let pose_rotated = result_rotated.pose(&end_effector).unwrap();

    let t_base = &pose_base.transform().translation;
    let t_rotated = &pose_rotated.transform().translation;

    // La posición debe ser idéntica independientemente de la rotación de muñeca
    assert!(
        (t_base.x - t_rotated.x).abs() < EPS
            && (t_base.y - t_rotated.y).abs() < EPS
            && (t_base.z - t_rotated.z).abs() < EPS,
        "Wrist rotation changed position: base ({}, {}, {}) vs rotated ({}, {}, {})",
        t_base.x, t_base.y, t_base.z,
        t_rotated.x, t_rotated.y, t_rotated.z
    );
}