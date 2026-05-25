use std::f64::consts::PI;

use thalos_core::{
    kinematics::forward::ForwardKinematics,
    models::factories::create_planar_2r,
};
use thalos_visual::{
    SceneBuilder, SceneError, SceneValidator, VisualScene,
};

/// Una escena válida debe pasar todas las verificaciones.
#[test]
fn valid_scene_passes() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let builder = SceneBuilder::new(&robot);
    let scene = builder.from_fk(&fk.evaluate(&[0.5, 0.3]));

    let validator = SceneValidator::default();
    assert!(validator.validate(&scene).is_ok());
}

/// Escena sin world debe fallar.
#[test]
fn missing_world_fails() {
    let scene = VisualScene {
        frames: vec![],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    assert_eq!(
        validator.validate(&scene),
        Err(SceneError::MissingWorld)
    );
}

/// IDs duplicados deben fallar.
#[test]
fn duplicate_ids_fail() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame("link_1", Some("world"), [1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
            frame("link_1", Some("world"), [2.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
        ],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    assert_eq!(
        validator.validate(&scene),
        Err(SceneError::DuplicateId {
            id: "link_1".into()
        })
    );
}

/// Frame con parent inexistente debe fallar.
#[test]
fn missing_parent_fails() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame("link_1", Some("phantom"), [1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
        ],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    assert_eq!(
        validator.validate(&scene),
        Err(SceneError::MissingFrame("phantom".into()))
    );
}

/// Ciclo en el grafo debe detectarse.
#[test]
fn cycle_detected() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame("a", Some("b"), [1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
            frame("b", Some("a"), [2.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
        ],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    let result = validator.validate(&scene);
    assert!(result.is_err(), "cycle should be detected");
    match result.unwrap_err() {
        SceneError::BrokenTopology { frame } => {
            assert!(frame == "a" || frame == "b");
        }
        other => panic!("expected BrokenTopology, got {:?}", other),
    }
}

/// Frame aislado (no conectado a world) debe fallar.
#[test]
fn orphan_frame_fails() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame("orphan", None, [5.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
        ],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    let result = validator.validate(&scene);
    assert!(result.is_err(), "orphan frame should fail");
}

/// Frame con NaN debe fallar.
#[test]
fn nan_value_detected() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame(
                "link_1",
                Some("world"),
                [f64::NAN, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0],
            ),
        ],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    assert_eq!(
        validator.validate(&scene),
        Err(SceneError::NonFiniteValue {
            frame: "link_1".into()
        })
    );
}

/// Cuaternión no unitario debe fallar.
#[test]
fn invalid_quaternion_detected() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame("link_1", Some("world"), [1.0, 0.0, 0.0], [5.0, 0.0, 0.0, 0.0]),
        ],
        links: vec![],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    let result = validator.validate(&scene);
    assert!(result.is_err(), "non-unit quaternion should fail");
    match result.unwrap_err() {
        SceneError::InvalidQuaternion { frame, norm } => {
            assert_eq!(frame, "link_1");
            assert!((norm - 5.0).abs() < 1e-10, "norm should be ~5.0, got {}", norm);
        }
        other => panic!("expected InvalidQuaternion, got {:?}", other),
    }
}

/// Link huérfano debe detectarse.
#[test]
fn orphan_link_detected() {
    let scene = VisualScene {
        frames: vec![
            frame("world", None, [0.0; 3], [1.0, 0.0, 0.0, 0.0]),
            frame("link_1", Some("world"), [1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
        ],
        links: vec![
            // Link correcto: world → link_1
            link([0.0, 0.0, 0.0], [1.0, 0.0, 0.0]),
            // Link huérfano: no corresponde a ningún parent-child
            link([5.0, 0.0, 0.0], [10.0, 0.0, 0.0]),
        ],
        joint_axes: vec![],
        twists: vec![],
    };

    let validator = SceneValidator::default();
    let result = validator.validate(&scene);
    assert!(result.is_err(), "orphan link should fail");
    match result.unwrap_err() {
        SceneError::OrphanLink { index } => assert_eq!(index, 1),
        other => panic!("expected OrphanLink, got {:?}", other),
    }
}

/// Twists count mismatch debe detectarse.
#[test]
fn twists_mismatch_detected() {
    let robot = create_planar_2r(1.0, 1.0);
    let fk = ForwardKinematics::new(robot.clone());
    let builder = SceneBuilder::new(&robot);
    let mut scene = builder.from_fk(&fk.evaluate(&[0.3, 0.5]));

    // Agregar un twist extra (deberían ser 2 ejes → 2 twists, pero ponemos 3)
    scene.twists.push(thalos_visual::VisualTwist {
        origin: [0.0; 3],
        linear: [0.0; 3],
        angular: [0.0; 3],
    });
    scene.twists.push(thalos_visual::VisualTwist {
        origin: [0.0; 3],
        linear: [0.0; 3],
        angular: [0.0; 3],
    });
    scene.twists.push(thalos_visual::VisualTwist {
        origin: [0.0; 3],
        linear: [0.0; 3],
        angular: [0.0; 3],
    });

    let validator = SceneValidator::default();
    let result = validator.validate(&scene);
    assert!(result.is_err(), "twists mismatch should fail");
    match result.unwrap_err() {
        SceneError::TwistsMismatch { expected, found } => {
            assert_eq!(expected, 2); // 2 joint axes
            assert_eq!(found, 3); // 3 twists
        }
        other => panic!("expected TwistsMismatch, got {:?}", other),
    }
}

// ─── Helpers ──────────────────────────────────────────────────────

fn frame(
    id: &str,
    parent: Option<&str>,
    translation: [f64; 3],
    rotation: [f64; 4],
) -> thalos_visual::VisualFrame {
    thalos_visual::VisualFrame {
        id: id.into(),
        parent: parent.map(|p| p.into()),
        translation,
        rotation,
    }
}

fn link(start: [f64; 3], end: [f64; 3]) -> thalos_visual::VisualLink {
    thalos_visual::VisualLink { start, end }
}
