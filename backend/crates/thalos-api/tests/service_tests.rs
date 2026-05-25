use std::f64::consts::PI;

use thalos_core::models::factories::create_planar_2r;
use thalos_api::SceneService;

#[test]
fn build_scene_returns_valid_scene() {
    let robot = create_planar_2r(1.0, 1.0);
    let service = SceneService::new(robot);
    let scene = service.build_scene(&[0.5, 0.3]);
    assert!(scene.is_ok(), "scene should build and validate");
}

#[test]
fn build_scene_deterministic() {
    let robot = create_planar_2r(1.0, 1.0);
    let service = SceneService::new(robot);
    let a = service.build_scene(&[0.3, 0.5]).unwrap();
    let b = service.build_scene(&[0.3, 0.5]).unwrap();
    assert_eq!(a, b, "same input must produce identical scene");
}

#[test]
fn build_scene_different_configs_differ() {
    let robot = create_planar_2r(1.0, 1.0);
    let service = SceneService::new(robot);
    let a = service.build_scene(&[0.0, 0.0]).unwrap();
    let b = service.build_scene(&[PI / 2.0, 0.0]).unwrap();
    let diff = service.diff(&a, &b, 1e-6);
    assert!(!diff.changed_frames.is_empty(), "different configs should differ");
}
