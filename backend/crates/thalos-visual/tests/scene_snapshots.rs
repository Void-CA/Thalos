use std::f64::consts::PI;

use thalos_core::{
    kinematics::forward::ForwardKinematics,
    models::factories::create_planar_2r,
};
use thalos_visual::SceneBuilder;

/// Planar 2R con ambos joints en 0: robot completamente extendido
/// sobre el eje X.
///
/// # Valores esperados (l1 = l2 = 1)
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
    let scene = builder.from_fk(&result).normalized();

    insta::assert_json_snapshot!(scene);
}

/// Planar 2R con q = [π/2, 0]: primera articulación a 90°, segunda recta.
///
/// Con l1 = l2 = 1:
/// - link_1 en:  translation ≃ [0, 1, 0]
/// - link_2 en:  translation ≃ [-1, 1, 0]
///
/// NOTA: cos(π/2) produce ~6.12e-17 en vez de 0 exacto.
/// El snapshot contiene estos valores, pero son determinísticos.
#[test]
fn planar_2r_bent_config() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let result = fk.evaluate(&[PI / 2.0, 0.0]);

    let builder = SceneBuilder::new(&robot);
    let scene = builder.from_fk(&result).normalized();

    insta::assert_json_snapshot!(scene);
}

// ─── Debug helper ─────────────────────────────────────────────────

/// Test helper que imprime el JSON de una escena.
/// Útil para debugging manual y para generar snapshots iniciales.
///
/// Ejecutar con:
/// ```bash
/// cargo test dump_json -- --nocapture
/// ```
#[test]
fn dump_json() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let result = fk.evaluate(&[0.0, 0.0]);

    let builder = SceneBuilder::new(&robot);
    let scene = builder.from_fk(&result).normalized();

    let json = serde_json::to_string_pretty(&scene).unwrap();
    println!("{}", json);
}
