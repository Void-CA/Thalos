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

    // Convención Y-up: Y=vertical, Z=profundidad
    // Link 1 = T(0, l1, 0) levanta el brazo; links 2+3 = T(l2+l3, 0, 0)
    assert!(
        (t.x - 2.0).abs() < EPS && (t.y - 1.0).abs() < EPS && t.z.abs() < EPS,
        "Expected ee at (2, 1, 0), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn base_yaw_90_rotates_workspace_into_negative_z() {
    // q1 = π/2 (Ry): +X local gira a -Z mundial.
    // El efector pasa de (2, 1, 0) a (0, 1, -2).
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[PI / 2.0, 0.0, 0.0], &ee);

    assert!(
        t.x.abs() < EPS && (t.y - 1.0).abs() < EPS && (t.z + 2.0).abs() < EPS,
        "Expected ee at (0, 1, -2), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn shoulder_down_makes_arm_vertical_downward() {
    // q2 = -π/2 (Rz): el hombro rota +X local hacia -Y mundial.
    // El brazo queda apuntando hacia abajo (Y negativo).
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[0.0, -PI / 2.0, 0.0], &ee);

    assert!(
        t.x.abs() < EPS && (t.y + 1.0).abs() < EPS && t.z.abs() < EPS,
        "Expected ee at (0, -1, 0), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn shoulder_up_makes_arm_vertical_upward() {
    // q2 = +π/2 (Rz): el hombro rota +X local hacia +Y mundial.
    // El brazo queda apuntando hacia arriba (+Y).
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[0.0, PI / 2.0, 0.0], &ee);

    assert!(
        t.x.abs() < EPS && (t.y - 3.0).abs() < EPS && t.z.abs() < EPS,
        "Expected ee at (0, 3, 0), got ({}, {}, {})",
        t.x, t.y, t.z
    );
}

#[test]
fn elbow_only_moves_ee_in_xy_plane() {
    // Con q1=q2=0, el efector está en (2, 1, 0).
    // q3 rota el tercer link en el plano XY (joint 3 es eje Z).
    // Por cada valor de q3, el efector traza un arco de radio l3 en XY,
    // centrado en (l2, l1, 0) = (1, 1, 0).
    let (fk, ee) = build();

    for &q3 in &[0.0, PI / 6.0, PI / 4.0, PI / 3.0, -PI / 4.0] {
        let t = ee_translation(&fk, &[0.0, 0.0, q3], &ee);

        // Distancia euclídea a (l2, l1, 0) debe ser exactamente l3 = 1.
        let dx = t.x - 1.0;
        let dy = t.y - 1.0;
        let r = (dx * dx + dy * dy).sqrt();

        assert!(
            (r - 1.0).abs() < 1e-9,
            "At q3={}, ee should be at distance 1 from (1, 1, 0), got ({}, {}, {}) → r={}",
            q3, t.x, t.y, t.z, r
        );

        // Z nunca se mueve: joint 3 es Z, por lo que Z se preserva.
        assert!(t.z.abs() < EPS, "z should be 0 at q3={}, got {}", q3, t.z);
    }
}

#[test]
fn base_yaw_is_invariant_when_arm_vertical() {
    // Cuando q2 = -π/2, el brazo queda alineado con -Y mundial.
    // En esa configuración, rotar q1 (eje Y) NO mueve el efector:
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
fn elbow_motion_keeps_z_zero_when_arm_vertical() {
    // Con q2 = -π/2, el brazo es vertical en -Y. Joint 3 (eje Z) es perpendicular
    // a la dirección del brazo, así que rotar el codo mueve el efector en el
    // plano XY — pero Z del efector no cambia (la simetría en Z se preserva).
    //
    // Ojo: q3 SÍ mueve el efector (a diferencia del yaw q1 que NO lo mueve
    // por la colinealidad). Lo que se preserva es la componente Z.
    let (fk, ee) = build();

    for &q3 in &[PI / 6.0, PI / 4.0, PI / 3.0, -PI / 4.0, -PI / 2.0] {
        let t = ee_translation(&fk, &[0.0, -PI / 2.0, q3], &ee);
        assert!(
            t.z.abs() < EPS,
            "Z should stay 0 when arm is vertical and q3 rotates, got z={} at q3={}",
            t.z, q3
        );
    }
}

#[test]
fn all_three_joints_accumulate_at_non_canonical_config() {
    // q1 = π/3 (60° de yaw Ry), q2 = -π/6 (hombro un poco abajo Rz), q3 = 0.
    //
    // Composición: cada link translation se rota por TODOS los joints previos.
    //
    //   Rz(-π/6) * (1, 0, 0) = (cos(-π/6), sin(-π/6), 0) = (√3/2, -1/2, 0)
    //   link2+link3 en esa dirección: 2 * (√3/2, -1/2, 0) = (√3, -1, 0)
    //   Tras link1 T(0, 1, 0): (√3, 0, 0)
    //   Ry(π/3) * (√3, 0, 0) = (√3/2, 0, -3/2)
    //
    //   ee = (√3/2, 0, -3/2)
    let (fk, ee) = build();
    let t = ee_translation(&fk, &[PI / 3.0, -PI / 6.0, 0.0], &ee);

    let expected_x = 3.0_f64.sqrt() / 2.0;
    let expected_y = 0.0;
    let expected_z = -1.5;

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
