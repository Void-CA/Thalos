
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::{
    backends::{
        controller::simulation::SimulationController,
        manager::BackendManager,
        InternalBackend,
    },
    commands::kinematics::KinematicsCommand,
    commands::motion::MotionCommands,
    Command, RobotController, RuntimeSnapshot, SceneService,
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

/// Create a SceneService with the given model and a BackendManager (simulation).
async fn make_service(model: RobotModel) -> (SceneService, Arc<BackendManager>) {
    let controller = Arc::new(RwLock::new(
        SimulationController::new(model.metadata().dof),
    )) as Arc<RwLock<dyn RobotController + Send + Sync>>;
    let manager = Arc::new(BackendManager::new());
    manager.set_active(controller).await.unwrap();
    let svc = SceneService::new(Box::new(InternalBackend), manager.clone(), model);
    (svc, manager)
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

#[tokio::test]
async fn set_joints_updates_state_and_fk() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let joints = vec![0.5, -0.3, 0.1, 0.0];

    let snap = svc.execute(Command::SetJoints(joints.clone())).await.unwrap();

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

#[tokio::test]
async fn load_robot_changes_model_and_resets_joints() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    // Set some joints first
    svc.execute(Command::SetJoints(vec![1.0, 2.0, 3.0, 4.0])).await.unwrap();

    let snap = svc.execute(Command::LoadRobot(RobotModel::Planar3R)).await.unwrap();

    assert_eq!(snap.robot, RobotModel::Planar3R);
    assert_eq!(snap.joints.len(), 3, "Planar3R has 3 DOF");
    // Joints reset to zero
    assert!(snap.joints.iter().all(|&j| j == 0.0));
}

#[tokio::test]
async fn load_robot_twice_produces_independent_snapshots() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;

    let snap1 = svc.execute(Command::LoadRobot(RobotModel::Planar2R)).await.unwrap();
    let snap2 = svc.execute(Command::LoadRobot(RobotModel::Scara)).await.unwrap();

    assert_eq!(snap1.robot, RobotModel::Planar2R);
    assert_eq!(snap2.robot, RobotModel::Scara);
    assert_eq!(snap1.joints.len(), 2);
    assert_eq!(snap2.joints.len(), 4);
}

#[tokio::test]
async fn load_robot_clears_active_plan() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;

    // Create a plan for Planar2R
    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![0.5, 0.3],
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .await.unwrap();
    assert!(
        snap.active_plan.is_some(),
        "plan must exist after PlanAndMoveJ",
    );

    // Load a different robot — plan must be cleared
    let snap = svc.execute(Command::LoadRobot(RobotModel::Scara)).await.unwrap();
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
#[tokio::test]
async fn move_to_position_converges_scara() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee = ee(&snap0);
    // Well within SCARA workspace: r_xy = sqrt(0.6²+0.5²) = 0.78 > r_min (0.50)
    let target = Vector3::new(0.6, 0.5, 0.25);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee,
        target,
    })).await.unwrap();

    assert_ee_at(&snap, target, 0.01);
}

/// Sequential MoveToPosition commands: each should converge from the
/// previous configuration.
#[tokio::test]
async fn move_to_position_sequential() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;

    // All targets within canonical SCARA workspace (r_min ≈ 0.50, r_max ≈ 1.8)
    let targets = [
        Vector3::new(0.7, 0.5, 0.25),
        Vector3::new(0.3, 0.8, 0.10),
        Vector3::new(0.5, 0.6, 0.00),
    ];

    let mut snap = svc.snapshot().await.unwrap();
    for &target in &targets {
        let ee = ee(&snap);
        snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition { frame: ee, target })).await.unwrap();
        assert_ee_at(&snap, target, 0.01);
    }
}

/// MoveToPosition with a frame that is not the chain's default end
/// effector — verifies the IK solver correctly handles arbitrary frames.
#[tokio::test]
async fn move_to_position_custom_frame() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap = svc.snapshot().await.unwrap();

    // Use prismatic_frame (id 3): the first frame whose Z is affected by q3
    let target_frame = FrameId::Id(3);
    let _initial = snap.fk_result.pose(&target_frame)
        .expect("target frame must exist")
        .translation();

    // Target within canonical SCARA workspace
    let target = Vector3::new(0.7, 0.5, 0.25);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: target_frame,
        target,
    })).await.unwrap();

    let final_pos = snap.fk_result.pose(&target_frame)
        .unwrap()
        .translation();
    let error = (target - final_pos).magnitude();
    assert!(
        error < 0.01,
        "frame position error: {:.4} (target {:.4?}, actual {:.4?})",
        error, target, final_pos,
    );
}

/// Reachable target close to the initial configuration with a Y offset
/// to avoid the X-axis singularity (full extension at q=[0,0,0,0]).
#[tokio::test]
async fn move_to_position_nearby() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee = ee(&snap0);

    // Target cerca del EE inicial (1.8, 0, 0.5), bien dentro del workspace
    let target = Vector3::new(1.5, 0.3, 0.4);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee,
        target,
    })).await.unwrap();

    assert_ee_at(&snap, target, 0.01);
}


// ─── MoveToPose (IK + FK round-trip with orientation) ─────────────

/// MoveToPose with identity rotation (same as initial SCARA orientation).
/// Since the orientation is already matched, the solver primarily works
/// on position error, but exercises the full 6-DOF IK path.
#[tokio::test]
async fn move_to_pose_converges_with_identity_rotation() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee_frame = ee(&snap0);

    let target_pos = Vector3::new(0.6, 0.5, 0.25);
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
    })).await.unwrap();

    assert_ee_at(&snap, target_pos, 0.01);
}

/// MoveToPose converges when both position and orientation targets
/// can be satisfied (using a planar 3R arm, targeting identity rot +
/// a reachable position).
#[tokio::test]
async fn move_to_pose_3r_converges() {
    let (svc, _mgr) = make_service(RobotModel::Planar3R).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee_frame = ee(&snap0);

    let target_pos = Vector3::new(2.5, 0.5, 0.0);
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
    })).await.unwrap();

    assert_ee_at(&snap, target_pos, 0.01);
}


// ─── Snapshot consistency ─────────────────────────────────────────

#[tokio::test]
async fn snapshot_after_ik_differs_from_initial() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee_frame = ee(&snap0);
    let initial_joints = snap0.joints.clone();

    let target = Vector3::new(0.2, 0.6, 0.0);
    let snap1 = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee_frame,
        target,
    })).await.unwrap();

    // Joints must have changed
    assert_ne!(snap1.joints, initial_joints);
    // Timestamps should differ
    assert!(snap1.generated_at > snap0.generated_at);
}

/// After an IK command, the snapshot carries solver metadata.
#[tokio::test]
async fn move_to_position_includes_ik_result() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee_frame = ee(&snap0);

    // Non-IK snapshot → ik_result is None
    assert!(snap0.ik_result.is_none(), "snapshot() must not have ik_result");

    let target = Vector3::new(0.6, 0.5, 0.25);
    let snap1 = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee_frame,
        target,
    })).await.unwrap();

    let ik = snap1.ik_result.as_ref()
        .expect("IK command snapshot must have ik_result");
    assert!(ik.status.is_converged(), "IK should converge: {:?}", ik.status);
    assert!(ik.iterations > 0, "IK should run at least one iteration");
    assert!(ik.final_error.is_finite(), "final_error must be finite");
}

/// Multiple snapshots without mutations must return consistent joints.
#[tokio::test]
async fn snapshot_is_deterministic() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;

    let snap1 = svc.snapshot().await.unwrap();
    let snap2 = svc.snapshot().await.unwrap();

    assert_eq!(snap1.joints, snap2.joints);
}


// ─── SolveIK (no mutation) ────────────────────────────────────────

#[tokio::test]
async fn solve_ik_returns_joints_without_mutating_state() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee_frame = ee(&snap0);
    let initial_joints = snap0.joints.clone();

    let target = Vector3::new(0.6, 0.5, 0.25);
    let (solved_joints, ik) = svc.solve_ik(ee_frame, IKGoal::Position(target)).await.unwrap();

    // Must return solved joints distinct from initial
    assert_ne!(solved_joints, initial_joints, "solve_ik must propose new joints");
    assert!(ik.status.is_converged(), "IK must converge");

    // State must NOT have changed
    let snap1 = svc.snapshot().await.unwrap();
    assert_eq!(
        snap1.joints, initial_joints,
        "solve_ik must NOT mutate runtime state",
    );
}


// ─── Edge cases ───────────────────────────────────────────────────

#[tokio::test]
async fn move_to_position_unreachable_still_produces_valid_fk() {
    let (svc, _mgr) = make_service(RobotModel::Scara).await;
    let snap0 = svc.snapshot().await.unwrap();
    let ee_frame = ee(&snap0);

    // Target far outside SCARA workspace
    let target = Vector3::new(10.0, 10.0, 0.0);

    let snap = svc.execute(Command::Kinematics(KinematicsCommand::MoveToPosition {
        frame: ee_frame,
        target,
    })).await.unwrap();

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

#[tokio::test]
async fn plan_and_movej_stores_trajectory_in_snapshot() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;
    let initial = svc.snapshot().await.unwrap();
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
        .await.unwrap();

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

#[tokio::test]
async fn plan_and_movej_reaches_target_position() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;
    let target = vec![1.5, -0.8];

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: target.clone(),
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .await.unwrap();

    assert_eq!(snap.joints, target, "joints must match the target after PlanAndMoveJ");
}

#[tokio::test]
async fn plan_and_movej_trajectory_starts_at_initial_position() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;
    let initial = svc.snapshot().await.unwrap().joints;

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![1.0, 0.5],
            max_velocity: None,
            max_acceleration: None,
            time_step: None,
        }))
        .await.unwrap();

    let plan = snap.active_plan.as_ref().unwrap();
    let first_waypoint = &plan.trajectory.waypoints()[0];

    assert_eq!(
        first_waypoint.joints(),
        &initial,
        "first waypoint must equal initial position",
    );
}

#[tokio::test]
async fn plan_and_movej_with_velocity_param() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;

    let snap = svc
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: vec![0.5, -0.3],
            max_velocity: Some(2.0),
            max_acceleration: Some(1.0),
            time_step: None,
        }))
        .await.unwrap();

    assert_eq!(snap.joints, vec![0.5, -0.3]);
    assert!(snap.active_plan.is_some());
}


// ─── PlanAndMoveL (cartesian → joint-space trajectory) ─────────────

#[tokio::test]
async fn plan_and_movel_stores_trajectory_in_snapshot() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;
    let snap0 = svc.snapshot().await.unwrap();
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
        .await.unwrap();

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

#[tokio::test]
async fn snapshot_includes_trajectory_after_plan_command() {
    let (svc, _mgr) = make_service(RobotModel::Planar2R).await;

    let snap1 = svc.snapshot().await.unwrap();
    assert!(snap1.active_plan.is_none());

    svc.execute(Command::Motion(MotionCommands::PlanAndMoveJ {
        target: vec![0.8, -0.4],
        max_velocity: None,
        max_acceleration: None,
        time_step: None,
    }))
    .await.unwrap();

    let snap2 = svc.snapshot().await.unwrap();
    assert!(
        snap2.active_plan.is_some(),
        "snapshot() must include active_plan after planning command",
    );

    // Trajectory persists in subsequent snapshots until replaced
    let snap3 = svc.snapshot().await.unwrap();
    assert!(
        snap3.active_plan.is_some(),
        "plan must persist across snapshots",
    );
}

// ─── SelectToolFrame ─────────────────────────────────────────────

#[tokio::test]
async fn select_tool_frame_sets_active_tcp_in_snapshot() {
    use thalos_core::robot::tool_frame::ToolFrame;

    let (svc, _mgr) = make_service(RobotModel::Scara).await;

    // Initial state: active_tcp is None
    let snap1 = svc.snapshot().await.unwrap();
    assert!(snap1.active_tcp.is_none(), "active_tcp should be None initially");

    // Set a TCP with identity transform
    let tcp = ToolFrame::identity(ee(&snap1));
    let snap2 = svc.execute(Command::SelectToolFrame(Some(tcp))).await.unwrap();

    assert!(snap2.active_tcp.is_some(), "active_tcp should be Some after SelectToolFrame");
    let active_tcp = snap2.active_tcp.as_ref().unwrap();
    assert_eq!(active_tcp.base_frame, ee(&snap2), "TCP base_frame should match the requested frame");
    assert!(!active_tcp.has_offset(), "TCP with identity transform should have no offset");

    // Clear the TCP
    let snap3 = svc.execute(Command::SelectToolFrame(None)).await.unwrap();
    assert!(snap3.active_tcp.is_none(), "active_tcp should be None after clearing");
}

#[tokio::test]
async fn select_tool_frame_with_offset_propagates_to_tick_delta() {
    use thalos_core::robot::tool_frame::ToolFrame;
    use thalos_core::math::geometry::rigid::Transform3D;
    use thalos_core::math::geometry::vectors::Vector3;

    let (svc, _mgr) = make_service(RobotModel::Scara).await;

    // Set a TCP with a 12cm offset below the flange
    let offset = Transform3D::from_translation(Vector3::new(0.0, 0.0, -0.12));
    let tcp = ToolFrame::with_offset(ee(&svc.snapshot().await.unwrap()), offset);
    svc.execute(Command::SelectToolFrame(Some(tcp))).await.unwrap();

    // Verify TickDelta includes the active_tcp
    let delta = svc.tick_execution_delta(0.0).await.unwrap();
    assert!(delta.active_tcp.is_some(), "TickDelta should include active_tcp");
    let active_tcp = delta.active_tcp.as_ref().unwrap();
    assert!(active_tcp.has_offset(), "TCP with non-identity transform should have offset");
}

#[tokio::test]
async fn select_tool_frame_persists_across_multiple_commands() {
    use thalos_core::robot::tool_frame::ToolFrame;

    let (svc, _mgr) = make_service(RobotModel::Scara).await;

    // Set a TCP
    let tcp = ToolFrame::identity(ee(&svc.snapshot().await.unwrap()));
    svc.execute(Command::SelectToolFrame(Some(tcp))).await.unwrap();

    // Execute other commands — TCP should persist
    svc.execute(Command::SetJoints(vec![0.5, -0.3, 0.1, 0.0])).await.unwrap();
    let snap = svc.snapshot().await.unwrap();
    assert!(snap.active_tcp.is_some(), "active_tcp should persist after SetJoints");

    svc.execute(Command::LoadRobot(RobotModel::Planar3R)).await.unwrap();
    // LoadRobot resets the robot, but active_tcp is independent of the robot model
    // It should still be set (though it may reference a frame that no longer exists)
    let snap2 = svc.snapshot().await.unwrap();
    // Note: In a real implementation, we might want to clear active_tcp on LoadRobot
    // For now, we just verify it persists
    assert!(snap2.active_tcp.is_some(), "active_tcp should persist after LoadRobot");
}

