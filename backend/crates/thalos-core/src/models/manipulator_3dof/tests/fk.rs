use crate::prelude::*;
use crate::models::factories::create_manipulator_3dof;

fn ee_translation(fk: &ForwardKinematics, q: &[f64], ee: &FrameId) -> Vector3 {
    fk.evaluate(q)
        .pose(ee)
        .unwrap()
        .transform()
        .translation
        .clone()
}

fn build() -> (ForwardKinematics, FrameId) {
    let robot = create_manipulator_3dof(1.0, 1.0, 1.0);
    let ee = robot.end_effector().clone();
    let fk = ForwardKinematics::new(robot);
    (fk, ee)
}

#[test]
fn has_three_segments_and_three_joints() {
    let robot = create_manipulator_3dof(1.0, 1.0, 1.0);
    assert_eq!(robot.segments.len(), 3, "Should have exactly three segments");
    assert_eq!(robot.segments[0].joint.id(), 0);
    assert_eq!(robot.segments[1].joint.id(), 1);
    assert_eq!(robot.segments[2].joint.id(), 2);
}

#[test]
fn zero_config_ee_at_l2_plus_l3_0_l1() {
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[0.0, 0.0, 0.0], &ee);

    assert!(
        (t.x - 2.0).abs() < EPS && t.y.abs() < EPS && (t.z - 1.0).abs() < EPS,
        "Expected ee at (2, 0, 1), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn base_yaw_90_rotates_workspace_into_y_axis() {
    // q1 = π/2: la base gira el plano de trabajo de XZ al plano YZ.
    // Como l2 y l3 están en X local, terminan en Y mundial.
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[PI / 2.0, 0.0, 0.0], &ee);

    assert!(
        t.x.abs() < EPS && (t.y - 2.0).abs() < EPS && (t.z - 1.0).abs() < EPS,
        "Expected ee at (0, 2, 1), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn shoulder_down_makes_arm_vertical_upward() {
    // q2 = -π/2: el hombro rota el X local de joint 2 hacia +Z mundial.
    // El brazo queda apuntando hacia arriba.
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[0.0, -PI / 2.0, 0.0], &ee);

    assert!(
        t.x.abs() < EPS && t.y.abs() < EPS && (t.z - 3.0).abs() < EPS,
        "Expected ee at (0, 0, 3), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn shoulder_up_makes_arm_vertical_downward() {
    // q2 = +π/2: el hombro rota el X local de joint 2 hacia -Z mundial.
    // R_y(π/2) · (1, 0, 0) = (0, 0, -1), así que el link 2 baja l2 (vuelve a z=0)
    // y el link 3 baja l3 más (a z = -1). Con l1=l2=l3=1, el efector queda en (0, 0, -1).
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[0.0, PI / 2.0, 0.0], &ee);

    assert!(
        t.x.abs() < EPS && t.y.abs() < EPS && (t.z - -1.0).abs() < EPS,
        "Expected ee at (0, 0, -1), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn elbow_only_moves_ee_in_xz_plane() {
    // Con q1=q2=0, el efector está en (2, 0, 1).
    // q3 rota el tercer link en el plano XZ (porque joint 3 es paralelo a Y).
    // Por cada valor de q3, el efector traza un arco de radio l3 en XZ,
    // centrado en (l2, 0, l1).
    let (fk, ee) = build();

    for &q3 in &[0.0, PI / 6.0, PI / 4.0, PI / 3.0, -PI / 4.0] {
        let t = ee_translation(&fk, &[0.0, 0.0, q3], &ee);

        // Distancia euclídea a (l2, 0, l1) debe ser exactamente l3 = 1.
        let dx = t.x - 1.0;
        let dz = t.z - 1.0;
        let r = (dx * dx + dz * dz).sqrt();

        assert!(
            (r - 1.0).abs() < 1e-9,
            "At q3={}, ee should be at distance 1 from (1, 0, 1), got ({}, {}, {}) → r={}",
            q3, t.x, t.y, t.z, r
        );

        // Y nunca se mueve: joint 1 y joint 2 no rotaron, y joint 3 es paralelo a Y.
        assert!(t.y.abs() < EPS, "y should be 0 at q3={}, got {}", q3, t.y);
    }
}

#[test]
fn base_yaw_is_invariant_when_arm_vertical() {
    // Cuando q2 = -π/2, el brazo queda alineado con el eje Z mundial.
    // En esa configuración, rotar q1 (eje Z) NO mueve el efector:
    // es la singularidad "brazo alineado con el eje de la base".
    let (fk, ee) = build();

    let t_ref = ee_translation(&fk, &[0.0, -PI / 2.0, 0.0], &ee);
    let t_yaw = ee_translation(&fk, &[PI / 3.0, -PI / 2.0, 0.0], &ee);

    let dx = (t_yaw.x - t_ref.x).abs();
    let dy = (t_yaw.y - t_ref.y).abs();
    let dz = (t_yaw.z - t_ref.z).abs();

    assert!(
        dx < EPS && dy < EPS && dz < EPS,
        "Base yaw should not move ee when arm is vertical. Δ=({}, {}, {})",
        dx, dy, dz
    );
}

#[test]
fn elbow_motion_keeps_y_zero_when_arm_vertical() {
    // Con q2 = -π/2, el brazo es vertical en Z. Joint 3 (eje Y) es perpendicular
    // a la dirección del brazo, así que rotar el codo mueve el efector en el
    // plano XZ — pero el Y del efector no cambia (la simetría en Y se preserva
    // porque ambos links extienden inicialmente en ±Z, que está en el plano y=0).
    //
    // Ojo: q3 SÍ mueve el efector (a diferencia del yaw q1 que NO lo mueve
    // por la colinealidad). Lo que se preserva es la componente Y.
    let (fk, ee) = build();

    for &q3 in &[PI / 6.0, PI / 4.0, PI / 3.0, -PI / 4.0, -PI / 2.0] {
        let t = ee_translation(&fk, &[0.0, -PI / 2.0, q3], &ee);
        assert!(
            t.y.abs() < EPS,
            "Y should stay 0 when arm is vertical and q3 rotates, got y={} at q3={}",
            t.y, q3
        );
        // Y también se mantiene en 0 cuando q1 rota (no es parte de este test,
        // pero confirma que la simetría se preserva bajo cualquier rotación en XZ
        // del efector cuando el brazo es vertical).
    }
}

#[test]
fn all_three_joints_accumulate_at_non_canonical_config() {
    // q1 = π/3 (60° de yaw), q2 = -π/6 (hombro un poco abajo), q3 = 0.
    //
    // Composición: cada link translation se rota por TODOS los joints previos
    // (incluyendo el propio). Convención verificada en el FK de este crate.
    //
    //   R_y(-π/6) * (1, 0, 0) = (cos(-π/6), 0, -sin(-π/6)) = (√3/2, 0, 1/2)
    //   R_z(π/3)  * (√3/2, 0, 1/2) = (√3/4, 3/4, 1/2)
    //   (q3 = 0, así que el link 3 recibe la misma rotación acumulada)
    //   ee = (0, 0, l1) + (√3/4, 3/4, 1/2) + (√3/4, 3/4, 1/2)
    //      = (√3/2, 3/2, 2)
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[PI / 3.0, -PI / 6.0, 0.0], &ee);

    let expected_x = 3.0_f64.sqrt() / 2.0;
    let expected_y = 1.5;
    let expected_z = 2.0;

    assert!(
        (t.x - expected_x).abs() < 1e-9,
        "x: expected {}, got {}", expected_x, t.x
    );
    assert!(
        (t.y - expected_y).abs() < 1e-9,
        "y: expected {}, got {}", expected_y, t.y
    );
    assert!(
        (t.z - expected_z).abs() < 1e-9,
        "z: expected {}, got {}", expected_z, t.z
    );
}
