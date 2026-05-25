use crate::prelude::*;
use crate::models::factories::create_planar_3r;

#[test]
fn returns_three_poses() {

    let robot = create_planar_3r(1.0, 1.0, 1.0);

    let fk = ForwardKinematics::new(robot);

    let result = fk.evaluate(&[0.0, 0.0, 0.0]);

    let frames: Vec<_> = result.frames().collect();

    assert_eq!(
        frames.len(),
        4,
        "Planar 3R should generate exactly three poses + world pose",
    );
}

#[test]
fn zero_configuration_places_end_effector_at_3_0_0() {

    let robot = create_planar_3r(1.0, 1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    let result = fk.evaluate(&[0.0, 0.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 3.0).abs() < EPS
            && t.y.abs() < EPS
            && t.z.abs() < EPS,

        "End effector should be at (3, 0, 0), got ({}, {}, {})",

        t.x,
        t.y,
        t.z
    );
}

#[test]
fn first_joint_90_deg_places_end_effector_at_0_3_0() {

    let robot = create_planar_3r(1.0, 1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    let result = fk.evaluate(&[PI / 2.0, 0.0, 0.0]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        t.x.abs() < EPS
            && (t.y - 3.0).abs() < EPS
            && t.z.abs() < EPS,

        "End effector should be at (0, 3, 0), got ({}, {}, {})",

        t.x,
        t.y,
        t.z
    );
}

#[test]
fn folded_configuration_places_end_effector_at_2_1_0() {

    let robot = create_planar_3r(1.0, 1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1 = π/2
    // q2 = -π/2
    // q3 = 0
    //
    // link1 -> (0,1)
    // link2 -> (1,1)
    // link3 -> (2,1)

    let result = fk.evaluate(&[
        PI / 2.0,
        -PI / 2.0,
        0.0
    ]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 2.0).abs() < EPS
            && (t.y - 1.0).abs() < EPS
            && t.z.abs() < EPS,

        "End effector should be at (2, 1, 0), got ({}, {}, {})",

        t.x,
        t.y,
        t.z
    );
}

#[test]
fn third_joint_rotates_relative_to_second_joint() {

    let robot = create_planar_3r(1.0, 1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1 = 0
    // q2 = 0
    // q3 = π/2
    //
    // link1 -> (1,0)
    // link2 -> (2,0)
    // link3 rotates upward locally
    //
    // expected = (2,1)

    let result = fk.evaluate(&[
        0.0,
        0.0,
        PI / 2.0
    ]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x - 2.0).abs() < EPS
            && (t.y - 1.0).abs() < EPS
            && t.z.abs() < EPS,

        "End effector should be at (2, 1, 0), got ({}, {}, {})",

        t.x,
        t.y,
        t.z
    );
}

#[test]
fn all_joint_rotations_accumulate_correctly() {

    let robot = create_planar_3r(1.0, 1.0, 1.0);

    let end_effector = robot
        .segments
        .last()
        .unwrap()
        .child
        .clone();

    let fk = ForwardKinematics::new(robot);

    // q1 = π/2
    // q2 = π/2
    // q3 = 0
    //
    // link1 -> (0,1)
    // link2 -> (-1,1)
    // link3 -> (-2,1)

    let result = fk.evaluate(&[
        PI / 2.0,
        PI / 2.0,
        0.0
    ]);

    let pose = result.pose(&end_effector).unwrap();

    let t = &pose.transform().translation;

    assert!(
        (t.x + 2.0).abs() < EPS
            && (t.y - 1.0).abs() < EPS
            && t.z.abs() < EPS,

        "End effector should be at (-2, 1, 0), got ({}, {}, {})",

        t.x,
        t.y,
        t.z
    );
}