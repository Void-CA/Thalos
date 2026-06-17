
use crate::{
    backends::InternalBackend,
    commands::kinematics::KinematicsCommand,
    commands::motion::MotionCommands,
    Command, RuntimeSnapshot, SceneService,
};
use thalos_core::{
    math::geometry::{
        rigid::Transform3D,
        rotations::UnitQuaternion,
        vectors::Vector3,
    },
    models::RobotModel,
    prelude::IKGoal,
    spatial::{frame::FrameId, pose::Pose},
};

// ─── Helpers ───────────────────────────────────────────────────────

/// Create a SceneService with the given model and default backend.
fn make_service(model: RobotModel) -> SceneService {
    SceneService::new(Box::new(InternalBackend), model)
}

/// Resolve the end effector frame from a snapshot's chain.
fn ee(snapshot: &RuntimeSnapshot) -> FrameId {
    *snapshot.chain.end_effector()
}

/// Assert that the FK position of the end effector in `snapshot`
/// is within `tol` of the expected `target` position.
fn assert_ee_at(snapshot: &RuntimeSnapshot, target: Vector3, tol: f64) {
    let frame = ee(snapshot);
    let pose = snapshot.fk_result.pose(&frame)
        .expect("end effector must exist in FK result");
    let pos = pose.translation();
    let error = (target - pos).magnitude();
    assert!(
        error < tol,
        "EE position error: {:.4} (tol {:.4})\n  expected: {:.4?}\n  actual:   {:.4?}",
        error, tol, target, pos,
    );
}


// ─── SetJoints ────────────────────────────────────────────────────

#[test]
fn set_joints_updates_state_and_fk() {
    let svc = make_service(RobotModel::Scara);
    let joints = vec![0.5, -0.3, 0.1, 0.0];

    let snap = svc.execute(Command::SetJoints(joints.clone())).unwrap();

    assert_eq!(snap.joints, joints);
    assert_eq!(snap.robot, RobotModel::Scara);
    // FK must be valid after setting joints
    let _pose = snap.fk_result.pose(&ee(&snap))
        .expect("FK result must contain end effector");
}

// NOTE: no hay test de "SetJoints con DOF incorrecto" porque el FK
// evalúa contra la cadena cinemática y paniquea si el tamaño de joints
// no coincide. La validación de DOF es responsabilidad del caller.


// ─── LoadRobot ────────────────────────────────────────────────────

#[test]
fn load_robot_changes_model_and_resets_joints() {
    let svc = make_service(RobotModel::Scara);
    // Set some joints first
    svc.execute(Command::SetJoints(vec![1.0, 2.0, 3.0, 4.0])).unwrap();

    let snap = svc.execute(Command::LoadRobot(RobotModel::Planar3R)).unwrap();

    assert_eq!(snap.robot, RobotModel::Planar3R);
    assert_eq!(snap.joints.len(), 3, "Planar3R has 3 DOF");
    // Joints reset to zero
    assert!(snap.joints.iter().all(|&j| j == 0.0));
}

#[test]
fn load_robot_twice_produces_independent_snapshots() {
    let svc = make_service(RobotModel::Scara);

    let snap1 = svc.execute(Command::LoadRobot(RobotModel::Planar2R)).unwrap();
    let snap2 = svc.execute(Command::LoadRobot(RobotModel::Scara)).unwrap();

    assert_eq!(snap1.robot, RobotModel::Planar2R);
    assert_eq!(snap2.robot, RobotModel::Scara);
    assert_eq!(snap1.joints.len(), 2);
    assert_eq!(snap2.joints.len(), 4);
}

#[test]
fn load_robot_clears_active_plan() {
    let svc = make_service(RobotModel::Planar2R);

    // Create a plan for Planar2R
    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![0.5, 0.3],
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .unwrap();
    assert!(
        snap.active_plan.is_some(),
        "plan must exist after PlanAndMoveJ",
    );

    // Load a different robot — plan must be cleared
    let snap = svc.execute(Command::LoadRobot(RobotModel::Scara)).unwrap();
    assert!(
        snap.active_plan.is_none(),
        "active_plan must be None after LoadRobot",
    );
    // New robot has 4 DOF, initialised to zero
    assert_eq!(snap.joints.len(), 4);
    assert!(snap.joints.iter().all(|&j| j == 0.0));
}


// ─── MoveToPosition (IK + FK round-trip) ──────────────────────────

/// Single execution of MoveToPosition on a SCARA: the solver should
/// bring the end effector within tolerance of the target.
#[test]
fn move_to_position_converges_scara() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee = ee(&snap0);
    let target = Vector3::new(0.3, 0.3, 0.0); // well within SCARA workspace

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee,
        target,
    })).unwrap();

    assert_ee_at(&snap, target, 0.01);
}

/// Sequential MoveToPosition commands: each should converge from the
/// previous configuration.
#[test]
fn move_to_position_sequential() {
    let svc = make_service(RobotModel::Scara);

    let targets = [
        Vector3::new(0.3, 0.3, 0.0),
        Vector3::new(-0.2, 0.5, 0.0),
        Vector3::new(0.0, 0.0, 0.0),
    ];

    let mut snap = svc.snapshot().unwrap();
    for &target in &targets {
        let ee = ee(&snap);
        snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition { frame: ee, target })).unwrap();
        assert_ee_at(&snap, target, 0.01);
    }
}

/// MoveToPosition with a custom frame (not the end effector).
/// The child frame "link_2" should move to the target.
/// NOTE: target includes a Y component to avoid the X-axis singularity
/// at full extension (q=[0,…,0]).
#[test]
fn move_to_position_custom_frame() {
    let svc = make_service(RobotModel::Scara);
    let snap = svc.snapshot().unwrap();

    // SCARA creates frames in order: link_1 (id 0), link_2 (id 1), …
    let link2 = FrameId::Id(1);
    let _link2_initial = snap.fk_result.pose(&link2)
        .expect("link_2 frame must exist")
        .translation();

    // Target bien dentro del workspace, lejos de singularidades
    let target = Vector3::new(1.5, 0.5, 0.0);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: link2,
        target,
    })).unwrap();

    let final_pos = snap.fk_result.pose(&link2)
        .unwrap()
        .translation();
    let error = (target - final_pos).magnitude();
    assert!(
        error < 0.01,
        "link_2 position error: {:.4} (target {:.4?}, actual {:.4?})",
        error, target, final_pos,
    );
}

/// Reachable target close to the initial configuration with a Y offset
/// to avoid the X-axis singularity (full extension at q=[0,0,0,0]).
#[test]
fn move_to_position_nearby() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee = ee(&snap0);

    // Target with Y component: evita singularidad de extensión total
    let target = Vector3::new(0.3, 0.1, 0.0);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee,
        target,
    })).unwrap();

    assert_ee_at(&snap, target, 0.01);
}


// ─── MoveToPose (IK + FK round-trip with orientation) ─────────────

/// MoveToPose with identity rotation (same as initial SCARA orientation).
/// Since the orientation is already matched, the solver primarily works
/// on position error, but exercises the full 6-DOF IK path.
#[test]
fn move_to_pose_converges_with_identity_rotation() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee_frame = ee(&snap0);

    let target_pos = Vector3::new(0.3, 0.3, 0.0);
    let identity_rot = UnitQuaternion::identity();
    let target_pose = Pose::new(
        FrameId::World,
        ee_frame,
        Transform3D {
            translation: target_pos,
            rotation: identity_rot,
        },
    );

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPose {
        frame: ee_frame,
        target: target_pose,
    })).unwrap();

    assert_ee_at(&snap, target_pos, 0.01);
}

/// MoveToPose converges when both position and orientation targets
/// can be satisfied (using a planar 3R arm, targeting identity rot +
/// a reachable position).
#[test]
fn move_to_pose_3r_converges() {
    let svc = make_service(RobotModel::Planar3R);
    let snap0 = svc.snapshot().unwrap();
    let ee_frame = ee(&snap0);

    let target_pos = Vector3::new(0.8, 0.5, 0.0);
    let identity_rot = UnitQuaternion::identity();
    let target_pose = Pose::new(
        FrameId::World,
        ee_frame,
        Transform3D {
            translation: target_pos,
            rotation: identity_rot,
        },
    );

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPose {
        frame: ee_frame,
        target: target_pose,
    })).unwrap();

    assert_ee_at(&snap, target_pos, 0.01);
}


// ─── Snapshot consistency ─────────────────────────────────────────

#[test]
fn snapshot_after_ik_differs_from_initial() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee_frame = ee(&snap0);
    let initial_joints = snap0.joints.clone();

    let target = Vector3::new(0.2, 0.6, 0.0);
    let snap1 = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee_frame,
        target,
    })).unwrap();

    // Joints must have changed
    assert_ne!(snap1.joints, initial_joints);
    // Timestamps should differ
    assert!(snap1.generated_at > snap0.generated_at);
}

/// After an IK command, the snapshot carries solver metadata.
#[test]
fn move_to_position_includes_ik_result() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee_frame = ee(&snap0);

    // Non-IK snapshot → ik_result is None
    assert!(snap0.ik_result.is_none(), "snapshot() must not have ik_result");

    let target = Vector3::new(0.3, 0.3, 0.0);
    let snap1 = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee_frame,
        target,
    })).unwrap();

    let ik = snap1.ik_result.as_ref()
        .expect("IK command snapshot must have ik_result");
    assert!(ik.status.is_converged(), "IK should converge: {:?}", ik.status);
    assert!(ik.iterations > 0, "IK should run at least one iteration");
    assert!(ik.final_error.is_finite(), "final_error must be finite");
}

/// Multiple snapshots without mutations must return consistent joints.
#[test]
fn snapshot_is_deterministic() {
    let svc = make_service(RobotModel::Scara);

    let snap1 = svc.snapshot().unwrap();
    let snap2 = svc.snapshot().unwrap();

    assert_eq!(snap1.joints, snap2.joints);
}


// ─── SolveIK (no mutation) ────────────────────────────────────────

#[test]
fn solve_ik_returns_joints_without_mutating_state() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee_frame = ee(&snap0);
    let initial_joints = snap0.joints.clone();

    let target = Vector3::new(0.3, 0.3, 0.0);
    let (solved_joints, ik) = svc.solve_ik(ee_frame, IKGoal::Position(target)).unwrap();

    // Must return solved joints distinct from initial
    assert_ne!(solved_joints, initial_joints, "solve_ik must propose new joints");
    assert!(ik.status.is_converged(), "IK must converge");

    // State must NOT have changed
    let snap1 = svc.snapshot().unwrap();
    assert_eq!(
        snap1.joints, initial_joints,
        "solve_ik must NOT mutate runtime state",
    );
}


// ─── Edge cases ───────────────────────────────────────────────────

#[test]
fn move_to_position_unreachable_still_produces_valid_fk() {
    let svc = make_service(RobotModel::Scara);
    let snap0 = svc.snapshot().unwrap();
    let ee_frame = ee(&snap0);

    // Target far outside SCARA workspace
    let target = Vector3::new(10.0, 10.0, 0.0);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee_frame,
        target,
    })).unwrap();

    // Even if IK fails to converge, the snapshot must have valid FK
    let pose = snap.fk_result.pose(&ee_frame)
        .expect("end effector must exist after failed IK");
    let _pos = pose.translation();

    // Joints must all be finite (no NaN from failed IK)
    for &j in &snap.joints {
        assert!(j.is_finite(), "joint {} is not finite", j);
    }
}


// ─── PlanAndMoveJ (joint-space trajectory) ─────────────────────────

#[test]
fn plan_and_movej_stores_trajectory_in_snapshot() {
    let svc = make_service(RobotModel::Planar2R);
    let initial = svc.snapshot().unwrap();
    assert!(
        initial.active_plan.is_none(),
        "initial snapshot must not have active_plan",
    );

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![1.0, 0.5],
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .unwrap();

    let plan = snap
        .active_plan
        .as_ref()
        .expect("snapshot must have active_plan after PlanAndMoveJ");
    let traj = &plan.trajectory;
    assert!(
        traj.len() >= 2,
        "trajectory should have at least 2 waypoints, got {}",
        traj.len(),
    );

    let progress = snap
        .trajectory_progress()
        .expect("snapshot must have trajectory_progress");
    assert!(
        (0.0..=1.0).contains(&progress),
        "trajectory_progress must be in [0, 1], got {progress}",
    );
}

#[test]
fn plan_and_movej_reaches_target_position() {
    let svc = make_service(RobotModel::Planar2R);
    let target = vec![1.5, -0.8];

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: target.clone(),
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .unwrap();

    assert_eq!(snap.joints, target, "joints must match the target after PlanAndMoveJ");
}

#[test]
fn plan_and_movej_trajectory_starts_at_initial_position() {
    let svc = make_service(RobotModel::Planar2R);
    let initial = svc.snapshot().unwrap().joints;

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![1.0, 0.5],
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .unwrap();

    let plan = snap.active_plan.as_ref().unwrap();
    let first_waypoint = &plan.trajectory.waypoints()[0];

    assert_eq!(
        first_waypoint.joints(),
        &initial,
        "first waypoint must equal initial position",
    );
}

#[test]
fn plan_and_movej_with_velocity_param() {
    let svc = make_service(RobotModel::Planar2R);

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![0.5, -0.3],
            max_velocity: Some(2.0),
            max_acceleration: Some(1.0),
            time_step: None,
        }))
        .unwrap();

    assert_eq!(snap.joints, vec![0.5, -0.3]);
    assert!(snap.active_plan.is_some());
}


// ─── PlanAndMoveL (cartesian → joint-space trajectory) ─────────────

#[test]
fn plan_and_movel_stores_trajectory_in_snapshot() {
    let svc = make_service(RobotModel::Planar2R);
    let snap0 = svc.snapshot().unwrap();
    let ee = *snap0.chain.end_effector();

    let target_pos = Vector3::new(0.3, 0.4, 0.0);
    let target_pose = Pose::new(
        FrameId::World,
        ee,
        Transform3D {
            translation: target_pos,
            rotation: UnitQuaternion::identity(),
        },
    );

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveL {
            frame: ee,
            target_pose,
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
            cartesian_step: None,
        }))
        .unwrap();

    let plan = snap
        .active_plan
        .as_ref()
        .expect("snapshot must have active_plan after PlanAndMoveL");
    let traj = &plan.trajectory;
    assert!(
        traj.len() >= 2,
        "trajectory should have at least 2 waypoints, got {}",
        traj.len(),
    );

    // Joints must be finite
    for &j in &snap.joints {
        assert!(j.is_finite(), "joint {} is not finite", j);
    }
}

#[test]
fn snapshot_includes_trajectory_after_plan_command() {
    let svc = make_service(RobotModel::Planar2R);

    let snap1 = svc.snapshot().unwrap();
    assert!(snap1.active_plan.is_none());

    svc.execute(Command::Motion(MotionCommands::PlanAndMoveJ {
        target: vec![0.8, -0.4],
        max_velocity: None,
        max_acceleration: None,
        time_step: None,
    }))
    .unwrap();

    let snap2 = svc.snapshot().unwrap();
    assert!(
        snap2.active_plan.is_some(),
        "snapshot() must include active_plan after planning command",
    );

    // Trajectory persists in subsequent snapshots until replaced
    let snap3 = svc.snapshot().unwrap();
    assert!(
        snap3.active_plan.is_some(),
        "plan must persist across snapshots",
    );
}

