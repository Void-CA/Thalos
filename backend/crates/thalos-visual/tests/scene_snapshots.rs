use std::f64::consts::PI;

use thalos_core::{
    kinematics::forward::ForwardKinematics,
    models::factories::create_planar_2r,
};
use thalos_visual::{SceneBuilder, SceneDiff, VisualPrecision};

/// Planar 2R con ambos joints en 0: robot completamente extendido
/// sobre el eje X.
///
/// # Valores exactos esperados (l1 = l2 = 1, precision default)
/// - link_1 en:  translation = [1, 0, 0]
/// - link_2 en:  translation = [2, 0, 0]
/// - Joint 0:    origin = [0, 0, 0], axis = [0, 0, 1]
/// - Joint 1:    origin = [1, 0, 0], axis = [0, 0, 1]
/// - Link 0:     [0,0,0] → [1,0,0]
/// - Link 1:     [1,0,0] → [2,0,0]
#[test]
fn planar_2r_zero_config() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let result = fk.evaluate(&[0.0, 0.0]);

    let builder = SceneBuilder::new(&robot);
    let scene = builder.from_fk(&result);

    insta::assert_json_snapshot!(scene);
}

/// Planar 2R con q = [π/2, 0]: primera articulación a 90°, segunda recta.
///
/// La canonicalización numérica convierte cos(π/2) ≈ 6.12e-17 a 0 exacto.
#[test]
fn planar_2r_bent_config() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let result = fk.evaluate(&[PI / 2.0, 0.0]);

    let builder = SceneBuilder::new(&robot);
    let scene = builder.from_fk(&result);

    insta::assert_json_snapshot!(scene);
}

/// Verifica la canonicalización numérica con precisión custom.
#[test]
fn precision_canonicalizes_noise() {
    let precision = VisualPrecision {
        epsilon_zero: 1e-10,
        decimal_places: 6,
    };

    // Un joint a π/2 produce cos(π/2) ≈ 6.12e-17 en la rotación.
    // Con precision default, eso se normaliza a 0 exacto.
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let result = fk.evaluate(&[PI / 2.0, 0.0]);

    let builder = SceneBuilder::new(&robot).with_precision(precision);
    let scene = builder.from_fk(&result);

    // link_1 está rotado 90°: su quaternion debería limpiarse
    let link_1 = scene
        .frames
        .iter()
        .find(|f| f.id == "link_1")
        .expect("link_1 frame expected");

    // En rotación de 90° alrededor de Z: w≈0.707107, z≈0.707107, x=0, y=0
    // El ruido sub-epsilon (6e-17) debe ser 0 exacto
    assert_eq!(link_1.rotation[1], 0.0, "x should be exactly 0 after normalization");
    assert_eq!(link_1.rotation[2], 0.0, "y should be exactly 0 after normalization");
    assert!(
        (link_1.rotation[0] - 0.707107).abs() < 1e-12,
        "w should be ~0.707107, got {}",
        link_1.rotation[0]
    );
    assert!(
        (link_1.rotation[3] - 0.707107).abs() < 1e-12,
        "z should be ~0.707107, got {}",
        link_1.rotation[3]
    );

    // link_1 traslación: [0, 1, 0], sin ruido en X
    assert_eq!(link_1.translation[0], 0.0, "tx should be exactly 0");
    assert_eq!(link_1.translation[1], 1.0, "ty should be 1");
}

/// SceneDiff: dos configuraciones distintas deben detectar cambios.
#[test]
fn diff_detects_translation_and_rotation() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let builder = SceneBuilder::new(&robot);

    let old = builder.from_fk(&fk.evaluate(&[0.0, 0.0]));
    let new = builder.from_fk(&fk.evaluate(&[PI / 2.0, 0.0]));

    let diff = SceneDiff::between(&old, &new, 1e-6);

    // No deberían haber frames agregados ni removidos
    assert!(diff.frames_added.is_empty(), "no frames should be added");
    assert!(diff.frames_removed.is_empty(), "no frames should be removed");

    // link_1 y link_2 deberían haber cambiado
    assert!(!diff.changed_frames.is_empty(), "frames should have changed");

    let link_1 = diff
        .changed_frames
        .iter()
        .find(|c| c.id == "link_1")
        .expect("link_1 should have changed");

    assert!(
        link_1.translation_delta > 0.0,
        "link_1 should have moved"
    );
    assert!(
        link_1.rotation_angle_deg > 0.0,
        "link_1 should have rotated"
    );

    // link_2 también debería haber cambiado
    let link_2 = diff
        .changed_frames
        .iter()
        .find(|c| c.id == "link_2")
        .expect("link_2 should have changed");

    assert!(
        link_2.translation_delta > 0.0,
        "link_2 should have moved"
    );
}

/// SceneDiff: misma escena debe producir diff vacío.
#[test]
fn diff_identical_scenes() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let builder = SceneBuilder::new(&robot);

    let old = builder.from_fk(&fk.evaluate(&[0.3, 0.5]));
    let new = builder.from_fk(&fk.evaluate(&[0.3, 0.5]));

    let diff = SceneDiff::between(&old, &new, 1e-6);

    assert!(diff.frames_added.is_empty());
    assert!(diff.frames_removed.is_empty());
    assert!(
        diff.changed_frames.is_empty(),
        "identical scenes should have no diff"
    );
}

// ─── Debug helper ─────────────────────────────────────────────────

/// Test helper que imprime el JSON de una escena.
#[test]
fn dump_json() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let result = fk.evaluate(&[0.0, 0.0]);

    let builder = SceneBuilder::new(&robot);
    let scene = builder.from_fk(&result);

    let json = serde_json::to_string_pretty(&scene).unwrap();
    println!("{}", json);
}
