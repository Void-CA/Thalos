//! Causal singularity remediation operators (design ADR-5 REVISION 2, M3).
//!
//! This module owns the two joint-space remediation operators:
//!
//! - [`DepartureReparameterizer`]: start-anchored singular regions — the
//!   segment departs from a FIXED singular start configuration, so a
//!   target-joints perturbation does nothing (the regenerated trajectory
//!   re-enters the cone from the fixed start). The operator raises the
//!   segment's motion limits so the trajectory clears the singular cone
//!   within ≤3 waypoints.
//! - [`SingularityDetourMaterializer`]: interior singular regions — the
//!   operator perturbs the joint configuration away from the cone.
//!
//! The [`departure_limits`] helper computes the velocity/acceleration that
//! guarantee cone clearance from the REAL robot's Jacobian: it walks the
//! segment's joint-space line, locates where the condition number exits the
//! cone, and derives the limits that push the trajectory past that point
//! within the departure window. The advisor computes these limits (it owns
//! the robot + observations); the materializers stay phenomenon-blind (C4)
//! and merely apply the values the advisor passes.
//!
//! The tests in this module are the causal contract: the reparameterized
//! trajectory MUST actually clear the singular cone on the REAL robot models.

use thalos_core::{
    analysis::action::ActionKind,
    kinematics::{
        forward::ForwardKinematics,
        jacobian::{GeometricJacobian, JacobianSolver, SingularityReport},
    },
    motion::segment::MotionSegment,
    robot::joint::JointKind,
    robot::serial_chain::SerialChain,
};

use crate::feedback::materializer::{MaterializationError, ProposalMaterializer};
use crate::feedback::operator::ActionProposal;
use crate::interpolate::joint::trapezoidal_profile;

/// The planner's fixed MoveJ time step (`compiler.rs` MoveJConfig.time_step).
pub const TIME_STEP: f64 = 0.01;

/// Near-singular threshold (TrajectoryAnalyzer): condition number ≥ 100 is a
/// NearSingularity Warning — the warning penalty also feeds the score, so the
/// departure must clear the FULL cone (cn < 100), not just the Error cone
/// (cn < 1000, which the full-cone clearance implies).
const NEAR_SINGULAR_THRESHOLD: f64 = 100.0;

/// Singularity threshold (TrajectoryAnalyzer): condition number ≥ 1000 is a
/// Singularity Error. The causal-preservation verification requires the
/// clamped departure to be OUTSIDE this cone from [`CLEAR_BY_WAYPOINT`] on.
const SINGULARITY_THRESHOLD: f64 = 1000.0;

/// How many waypoints from the segment start a region may begin and still be
/// treated as "start-anchored" (the fixed-start departure window).
///
/// Strict equality with the segment start FAILS for the Scara: its prismatic
/// Z column keeps the linear Jacobian full-rank at q2 = 0, so the grouped
/// region starts ONE waypoint after the segment start (the fixed start itself
/// is NOT singular there). The window is the design's trigger
/// (`region.start == segment.start`) widened by the documented quirk.
pub const DEPARTURE_WINDOW: usize = 2;

/// Waypoint index at which the reparameterized departure must have cleared
/// the cone: the cone may occupy at most `DEPARTURE_WINDOW + 1` waypoints
/// (indices 0..=2 → ≤3 waypoints, spec "clears within ≤3 waypoints").
const CLEAR_BY_WAYPOINT: usize = DEPARTURE_WINDOW + 1;

/// Default joint-space perturbation (radians) for interior MoveJ regions.
pub const DEFAULT_PERTURBATION: f64 = 0.1;

/// Pre-computed remediation strategy for a Singularity recommendation
/// (design ADR-5 REVISION 2). The advisor routes the region:
///
/// - start-anchored → [`SingularityStrategy::Departure`] with limits that
///   clear the cone within the departure window;
/// - interior → [`SingularityStrategy::Detour`] (joint-space perturbation).
#[derive(Debug, Clone, PartialEq)]
pub enum SingularityStrategy {
    /// Raise the segment's motion limits so the departure clears the cone.
    Departure {
        /// New `max_velocity` for the MoveJ (rad/s).
        max_velocity: f64,
        /// New `max_acceleration` for the MoveJ (rad/s²).
        max_acceleration: f64,
    },
    /// Perturb the joint configuration away from the cone.
    Detour {
        /// Joint-space displacement (radians) applied to the MoveJ target.
        perturbation: f64,
    },
}

/// Computes the motion limits that clear the singular cone within the
/// departure window, for a MoveJ departing from `start` toward `target` on
/// the real `robot` (design ADR-5 REVISION 2, "compute the needed
/// acceleration from the cone geometry").
///
/// The MoveJ interpolates joints along the straight line
/// `q(s) = start + (target − start)·s` with normalized position
/// `s(t) = 0.5·a·t² / dist` in the acceleration-limited phase. The helper:
///
/// 1. walks the line evaluating the REAL Jacobian's condition number and
///    finds `s_exit` — the largest normalized distance still inside the
///    cone (cn ≥ 100). The walk (not a monotonic scan) handles the Scara's
///    quirk: its prismatic Z column keeps cn finite at `s = 0`.
/// 2. derives the acceleration that reaches `s ≥ s_exit` by waypoint
///    `CLEAR_BY_WAYPOINT`: `a = 2·s_exit·dist / (k·dt)²`, with margin;
/// 3. derives the velocity that keeps the profile ACCELERATION-LIMITED
///    (triangular) through the cone exit, with margin.
///
/// Returns `(max_velocity, max_acceleration)`, or `(0.0, 0.0)` when no cone
/// lies on the line (nothing to reparameterize — the caller keeps the
/// original limits and verification judges honesty).
pub fn departure_limits(
    robot: &SerialChain,
    start: &[f64],
    target: &[f64],
    time_step: f64,
) -> (f64, f64) {
    let delta: Vec<f64> = start
        .iter()
        .zip(target)
        .map(|(a, b)| b - a)
        .collect();
    let dist = delta.iter().fold(0.0_f64, |m, d| m.max(d.abs()));
    if dist < 1e-9 {
        return (0.0, 0.0); // degenerate (zero displacement) — no departure to reparameterize
    }

    let fk = ForwardKinematics::new(robot.clone());
    let jacobian = GeometricJacobian::new(fk, *robot.end_effector());

    // Walk the line. cn(s) is NOT monotonic in general (the Scara's cn starts
    // finite at s=0), so track the LARGEST s still inside the cone.
    let steps = 2000;
    let mut s_exit = 0.0_f64;
    for i in 1..=steps {
        let s = i as f64 / steps as f64;
        let q: Vec<f64> = start
            .iter()
            .zip(&delta)
            .map(|(a, d)| a + d * s)
            .collect();
        let cn = SingularityReport::analyze(&jacobian.evaluate(&q)).condition_number;
        if cn >= NEAR_SINGULAR_THRESHOLD {
            s_exit = s;
        }
    }
    if s_exit <= 0.0 {
        return (0.0, 0.0); // no cone on this line — nothing to reparameterize
    }

    // Acceleration: reach s_exit by waypoint CLEAR_BY_WAYPOINT (t = k·dt).
    // s(t) = 0.5·a·t²/dist → a = 2·s_exit·dist / (k·dt)². ×1.5 margin.
    let k = CLEAR_BY_WAYPOINT as f64;
    let t = k * time_step;
    let a = 2.0 * s_exit * dist / (t * t) * 1.5;

    // Velocity: keep the profile acceleration-limited through s_exit
    // (triangular condition v²/a ≥ dist) AND reach s_exit fast enough.
    let v_at_exit = (2.0 * a * s_exit * dist).sqrt();
    let v_triangular = (a * dist).sqrt();
    let v = v_at_exit.max(v_triangular).max(1.0) * 1.5;

    (v, a)
}

/// Physical motion envelope: the per-robot actuation ceiling the departure
/// operator may NOT exceed (P1 physical-limits contract, 4R findings R1-1 /
/// R4-2).
///
/// ## Limit source
/// The catalog specs declare POSITION limits only — every toy model builds
/// its joints with `JointLimits::new(min, max)` leaving `velocity` and
/// `effort` as `None` (verified `models/*/spec.rs`, M1–M4). There is therefore
/// NO per-robot velocity/acceleration data on the chain. P1 defines a per-robot
/// SAFETY CEILING table keyed by the chain's actuated-joint signature
/// (`dof_count` + joint-kind sequence — the only robot identity the planner
/// holds; `SerialChain` carries no `RobotModel`), NOT a global constant.
///
/// The ceilings are sized to:
/// 1. cover the documented M3 departures (measured on the real Jacobians:
///    Planar3R ~22.5 rad/s / ~448 rad/s², Scara ~17.4 rad/s / ~269 rad/s²)
///    with headroom, so the permanent usability scenarios (24→1, 17→0) keep
///    passing; and
/// 2. bound extreme departures (the 4R finding: a straight-extension
///    departure needs ~61 rad/s / ~1667 rad/s² — unbounded on the old code).
///
/// Unknown chains (URDF-loaded robots, future models) fall back to the
/// conservative [`GENERIC_ENVELOPE`]. The documented extension point for real
/// robots is `JointLimits.velocity` / `JointLimits.effort` on the chain's
/// joints — when a spec or URDF declares them, this table is the override
/// site.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalEnvelope {
    /// Maximum joint velocity (rad/s) the departure operator may request.
    pub max_velocity: f64,
    /// Maximum joint acceleration (rad/s²) the departure operator may request.
    pub max_acceleration: f64,
}

/// SCARA (4 dof: R-R-P-R) safety ceiling.
pub const SCARA_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 25.0,
    max_acceleration: 600.0,
};

/// Planar3R / Manipulator3DOF (3 dof, all revolute) safety ceiling.
pub const PLANAR_3R_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 30.0,
    max_acceleration: 900.0,
};

/// Planar2R (2 dof, both revolute) safety ceiling.
pub const PLANAR_2R_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 20.0,
    max_acceleration: 500.0,
};

/// SingleRevolute (1 dof) safety ceiling.
pub const SINGLE_REVOLUTE_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 15.0,
    max_acceleration: 400.0,
};

/// CylindricalRPP (R-P-P) safety ceiling.
pub const CYLINDRICAL_RPP_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 20.0,
    max_acceleration: 500.0,
};

/// SphericalPolarRRP (R-R-P) safety ceiling.
pub const SPHERICAL_POLAR_RRP_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 20.0,
    max_acceleration: 500.0,
};

/// Manipulator6DOF (6 dof, all revolute) safety ceiling.
pub const MANIPULATOR_6DOF_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 25.0,
    max_acceleration: 600.0,
};

/// Generic ceiling for unknown chains (URDF-loaded robots, future models):
/// the most conservative entry in the table.
pub const GENERIC_ENVELOPE: PhysicalEnvelope = PhysicalEnvelope {
    max_velocity: 15.0,
    max_acceleration: 400.0,
};

impl PhysicalEnvelope {
    /// The envelope for the robot the chain describes (P1 per-robot limit
    /// source): keyed by the actuated-joint signature (`dof_count` + joint
    /// kinds in segment order).
    pub fn for_chain(chain: &SerialChain) -> Self {
        let kinds: Vec<JointKind> = chain
            .segments
            .iter()
            .filter(|s| s.joint.dof() > 0)
            .map(|s| s.joint.kind())
            .collect();
        Self::for_signature(chain.dof_count(), &kinds)
    }

    /// Envelope for a `(dof_count, joint-kind sequence)` signature. Unknown
    /// signatures fall back to [`GENERIC_ENVELOPE`].
    pub fn for_signature(dof: usize, kinds: &[JointKind]) -> Self {
        use JointKind::{Prismatic, Revolute};
        match (dof, kinds) {
            (4, [Revolute, Revolute, Prismatic, Revolute]) => SCARA_ENVELOPE,
            (6, [Revolute, Revolute, Revolute, Revolute, Revolute, Revolute]) => {
                MANIPULATOR_6DOF_ENVELOPE
            }
            (3, [Revolute, Revolute, Revolute]) => PLANAR_3R_ENVELOPE,
            (3, [Revolute, Prismatic, Prismatic]) => CYLINDRICAL_RPP_ENVELOPE,
            (3, [Revolute, Revolute, Prismatic]) => SPHERICAL_POLAR_RRP_ENVELOPE,
            (2, [Revolute, Revolute]) => PLANAR_2R_ENVELOPE,
            (1, [Revolute]) => SINGLE_REVOLUTE_ENVELOPE,
            _ => GENERIC_ENVELOPE,
        }
    }
}

/// The departure limits clamped to the robot's physical envelope, WITH causal
/// preservation (P1 contract, spec causal-remediation "Physical Limits
/// Respected").
///
/// The flow:
/// 1. compute the ideal cone-clearing limits ([`departure_limits`]);
/// 2. clamp both to [`PhysicalEnvelope::for_chain`] — acceleration AND
///    velocity, per-robot;
/// 3. RE-VERIFY the causal goal on the clamped profile: walk the SAME
///    trajectory math the planner uses (`trapezoidal_profile` — the
///    dispatcher's MoveJ planner at `compiler.rs` runs exactly this) and
///    check the singular cone (cn ≥ 1000) is still cleared within the
///    departure window.
///
/// Returns `Some((v, a))` when the clamped profile STILL clears the cone —
/// the edit is honest: the repair keeps its causal goal within the physical
/// envelope (the DUAL acceptance criterion: acceleration ≤ limit AND the
/// remediation still removes the promised singular condition).
///
/// Returns `None` when the physics cannot clear the cone within the envelope
/// (e.g. a departure whose target is itself inside the cone): the caller MUST
/// NOT emit a clamped-but-failing edit — `reparación causal → clamp →
/// trayectoria que ya no sale del cono` is forbidden. The recommendation
/// degrades honestly to `Unavailable` (the whole-region gate then reports
/// `PlanningFailed`).
pub fn clamped_departure_limits(
    robot: &SerialChain,
    start: &[f64],
    target: &[f64],
    time_step: f64,
) -> Option<(f64, f64)> {
    let (ideal_v, ideal_a) = departure_limits(robot, start, target, time_step);
    if ideal_a <= 0.0 {
        return None; // no cone on this line — nothing to reparameterize
    }
    let envelope = PhysicalEnvelope::for_chain(robot);
    let v = ideal_v.min(envelope.max_velocity);
    let a = ideal_a.min(envelope.max_acceleration);
    profile_clears_cone(robot, start, target, v, a, time_step).then_some((v, a))
}

/// Re-verifies causal preservation on the CLAMPED limits (P1): walk the
/// planner's exact trajectory math ([`trapezoidal_profile`] — the same
/// function the MoveJ dispatcher runs at `compiler.rs`) and check that every
/// waypoint at index ≥ [`CLEAR_BY_WAYPOINT`] is OUTSIDE the singular cone
/// (cn < 1000) — the trajectory clears the cone within the departure window.
///
/// The final waypoint (the departure target) is also required to be outside
/// the cone: a departure whose TARGET is itself inside the cone can never
/// clear it (degenerate short profiles that end before the window would
/// otherwise pass vacuously and lie).
fn profile_clears_cone(
    robot: &SerialChain,
    start: &[f64],
    target: &[f64],
    max_velocity: f64,
    max_acceleration: f64,
    time_step: f64,
) -> bool {
    let fk = ForwardKinematics::new(robot.clone());
    let jacobian = GeometricJacobian::new(fk, *robot.end_effector());
    let traj = trapezoidal_profile(start, target, max_velocity, max_acceleration, time_step);
    let cleared = |joints: &[f64]| {
        SingularityReport::analyze(&jacobian.evaluate(joints)).condition_number
            < SINGULARITY_THRESHOLD
    };
    traj.iter()
        .enumerate()
        .skip(CLEAR_BY_WAYPOINT)
        .all(|(_, wp)| cleared(wp.joints()))
        && traj.last().is_some_and(|wp| cleared(wp.joints()))
}

/// Start-anchored singular regions: raise the segment's motion limits so the
/// departure clears the singular cone within ≤3 waypoints (design ADR-5
/// REVISION 2, spec causal-remediation "Departure-Reparameterization").
///
/// The materializer only APPLIES the limits the advisor computed — it never
/// perturbs target joints and never computes condition numbers (C4:
/// phenomenon-blind). The limits are guaranteed by [`departure_limits`].
pub struct DepartureReparameterizer {
    max_velocity: f64,
    max_acceleration: f64,
}

impl DepartureReparameterizer {
    /// Creates the operator with the cone-clearing limits from
    /// [`departure_limits`].
    pub fn new(max_velocity: f64, max_acceleration: f64) -> Self {
        Self {
            max_velocity,
            max_acceleration,
        }
    }
}

impl ProposalMaterializer for DepartureReparameterizer {
    fn name(&self) -> &'static str {
        "departure_reparameterizer"
    }

    fn materialize(
        &self,
        proposal: &ActionProposal,
        target: &MotionSegment,
    ) -> Result<Vec<MotionSegment>, MaterializationError> {
        if proposal.kind != ActionKind::Singularity {
            return Err(MaterializationError::UnsupportedProposal {
                kind: proposal.kind,
            });
        }
        let MotionSegment::MoveJ {
            origin,
            target: joints,
            max_velocity,
            max_acceleration,
        } = target
        else {
            return Err(MaterializationError::UnsupportedSegment);
        };

        // The operator RAISES limits — it never downgrades the user's
        // original values (defensive: the computed limits should always
        // exceed them, but original limits win when they do not).
        let raised_v = max_velocity.map_or(self.max_velocity, |original| original.max(self.max_velocity));
        let raised_a = max_acceleration.map_or(self.max_acceleration, |original| {
            original.max(self.max_acceleration)
        });

        Ok(vec![MotionSegment::MoveJ {
            origin: origin.clone(),
            target: joints.clone(),
            max_velocity: Some(raised_v),
            max_acceleration: Some(raised_a),
        }])
    }
}

/// Interior singular regions: perturb the joint configuration away from the
/// cone (spec causal-remediation "Interior singularity uses joint-space
/// perturbation").
///
/// The perturbation is a small joint-space displacement applied to the MoveJ
/// target, so the regenerated straight-line path no longer passes through the
/// cone. MoveL targets carry no joint configuration to perturb — a documented
/// gap (the Cartesian retarget operator is M4 scope) surfaced honestly as
/// [`MaterializationError::UnsupportedSegment`].
pub struct SingularityDetourMaterializer {
    perturbation: f64,
}

impl SingularityDetourMaterializer {
    /// Creates the operator with the joint-space displacement (radians).
    pub fn new(perturbation: f64) -> Self {
        Self { perturbation }
    }
}

impl ProposalMaterializer for SingularityDetourMaterializer {
    fn name(&self) -> &'static str {
        "singularity_detour_materializer"
    }

    fn materialize(
        &self,
        proposal: &ActionProposal,
        target: &MotionSegment,
    ) -> Result<Vec<MotionSegment>, MaterializationError> {
        if proposal.kind != ActionKind::Singularity {
            return Err(MaterializationError::UnsupportedProposal {
                kind: proposal.kind,
            });
        }
        let MotionSegment::MoveJ {
            origin,
            target: joints,
            max_velocity,
            max_acceleration,
        } = target
        else {
            return Err(MaterializationError::UnsupportedSegment);
        };

        Ok(vec![MotionSegment::MoveJ {
            origin: origin.clone(),
            target: joints.iter().map(|j| j + self.perturbation).collect(),
            max_velocity: *max_velocity,
            max_acceleration: *max_acceleration,
        }])
    }
}

#[cfg(test)]
mod tests {
    use thalos_core::{
        analysis::action::{ActionImpact, ActionKind, ActionPriority},
        analysis::observation::ObservationId,
        ids::OperationId,
        kinematics::{
            forward::ForwardKinematics,
            jacobian::{GeometricJacobian, JacobianSolver, SingularityReport},
        },
        models::{RobotModel, RobotRegistry},
        motion::segment::MotionSegment,
        robot::serial_chain::SerialChain,
        spatial::frame::FrameId,
    };

    use crate::feedback::operator::ActionProposal;
    use crate::feedback::materializer::{MaterializationError, ProposalMaterializer};
    use crate::interpolate::joint::trapezoidal_profile;

    use super::{
        DEFAULT_PERTURBATION, SingularityDetourMaterializer, SingularityStrategy,
        DepartureReparameterizer, TIME_STEP, departure_limits, PhysicalEnvelope,
        clamped_departure_limits,
    };

    fn chain(model: RobotModel) -> SerialChain {
        RobotRegistry::create_default(model)
    }

    fn movej(target: Vec<f64>) -> MotionSegment {
        MotionSegment::MoveJ {
            origin: OperationId("op-j".to_string()),
            target,
            max_velocity: None,
            max_acceleration: None,
        }
    }

    fn move_l() -> MotionSegment {
        MotionSegment::MoveL {
            origin: OperationId("op-l".to_string()),
            frame: FrameId::World,
            target_pose: thalos_core::spatial::pose::Pose::new(
                FrameId::World,
                FrameId::Id(1),
                thalos_math::Transform3D::identity(),
            ),
            max_velocity: None,
        }
    }

    fn proposal(kind: ActionKind) -> ActionProposal {
        ActionProposal {
            kind,
            target_observation: ObservationId(1),
            priority: ActionPriority::High,
            impact: ActionImpact::High,
            parameters: std::collections::BTreeMap::new(),
        }
    }

    /// Condition number of the real robot at `q`.
    fn condition_number(chain: &SerialChain, q: &[f64]) -> f64 {
        let fk = ForwardKinematics::new(chain.clone());
        let jac = GeometricJacobian::new(fk, *chain.end_effector());
        SingularityReport::analyze(&jac.evaluate(q)).condition_number
    }

    /// Re-simulate the reparameterized MoveJ and verify the singular cone is
    /// cleared within the departure window (spec "≤3 waypoints"): every
    /// waypoint at index ≥ `DEPARTURE_WINDOW + 1` must be OUTSIDE the
    /// Singularity threshold, and fewer than 4 waypoints may remain singular
    /// (so the score recovers above saturation).
    fn assert_cone_cleared(
        chain: &SerialChain,
        start: &[f64],
        target: &[f64],
        max_velocity: f64,
        max_acceleration: f64,
    ) {
        assert!(
            max_acceleration > 0.0 && max_velocity > 0.0,
            "the reparameterizer must produce positive limits, got v={max_velocity} a={max_acceleration}"
        );
        let traj = trapezoidal_profile(start, target, max_velocity, max_acceleration, TIME_STEP);
        let mut errors: usize = 0;
        for (i, wp) in traj.iter().enumerate() {
            let cn = condition_number(chain, wp.joints());
            if cn >= 1000.0 {
                errors += 1;
                assert!(
                    i < super::DEPARTURE_WINDOW + 1,
                    "waypoint {i} (cn={cn:.1}) is still inside the singular cone after the departure window"
                );
            }
        }
        assert!(
            errors < 4,
            "the reparameterized departure must leave fewer than 4 singular waypoints (score recovery), got {errors}"
        );
    }

    #[test]
    fn departure_limits_clear_scara_cone_within_three_waypoints() {
        // Scenario B (usability edits_improve): the MoveJ departs from the
        // fully-extended singular start [0,0,0,0]. The original
        // acceleration-limited profile keeps |q2| in the cone for ~17
        // waypoints. The reparameterized limits must clear the cone (cn <
        // 1000, ideally < 100) within ≤3 waypoints — the causal fix.
        let robot = chain(RobotModel::Scara);
        let start = vec![0.0, 0.0, 0.0, 0.0];
        let target = vec![0.5, -0.3, -0.1, 0.0];

        let (v, a) = departure_limits(&robot, &start, &target, TIME_STEP);
        assert!(
            a >= 6.0,
            "design floor: a >= ~6 rad/s^2 clears the Scara cone, got {a}"
        );
        assert_cone_cleared(&robot, &start, &target, v, a);
    }

    #[test]
    fn departure_limits_clear_planar3r_cone_within_three_waypoints() {
        // Scenario A (usability edits_improve): same departure shape on the
        // Planar3R. The reparameterized limits must clear the cone quickly
        // enough that the score recovers (≤3 singular waypoints AND few
        // near-singular warnings — the warnings also carry penalty).
        let robot = chain(RobotModel::Planar3R);
        let start = vec![0.0, 0.0, 0.0];
        let target = vec![0.5, -0.3, 0.1];

        let (v, a) = departure_limits(&robot, &start, &target, TIME_STEP);
        assert_cone_cleared(&robot, &start, &target, v, a);
    }

    #[test]
    fn departure_reparameterizer_raises_movej_limits_and_keeps_target() {
        // Spec causal-remediation "Start-anchored singularity uses departure
        // operator": the edit SHALL raise the segment's motion limits (never
        // perturb target joints). Origin/target are preserved; only the
        // limits change.
        let materializer = DepartureReparameterizer::new(20.0, 500.0);
        let segments = materializer
            .materialize(&proposal(ActionKind::Singularity), &movej(vec![0.5, -0.3, 0.1]))
            .expect("departure must materialize a MoveJ");
        assert_eq!(segments.len(), 1);
        match &segments[0] {
            MotionSegment::MoveJ {
                target,
                max_velocity,
                max_acceleration,
                ..
            } => {
                assert_eq!(target, &vec![0.5, -0.3, 0.1], "target joints must stay untouched");
                assert_eq!(*max_acceleration, Some(500.0), "max_acceleration must be raised");
                assert_eq!(*max_velocity, Some(20.0), "max_velocity must be raised");
            }
            other => panic!("expected MoveJ, got {other:?}"),
        }
    }

    #[test]
    fn departure_reparameterizer_rejects_movel_and_wrong_kind() {
        let materializer = DepartureReparameterizer::new(20.0, 500.0);
        match materializer.materialize(&proposal(ActionKind::Singularity), &move_l()) {
            Err(MaterializationError::UnsupportedSegment) => {}
            other => panic!("expected UnsupportedSegment, got {other:?}"),
        }
        match materializer.materialize(&proposal(ActionKind::Manipulability), &movej(vec![0.5, 0.5])) {
            Err(MaterializationError::UnsupportedProposal { .. }) => {}
            other => panic!("expected UnsupportedProposal, got {other:?}"),
        }
    }

    #[test]
    fn departure_reparameterizer_never_downgrades_original_limits() {
        // The operator RAISES limits: when the caller's computed limits are
        // lower than the segment's original ones (defensive), the original
        // values win.
        let segment = MotionSegment::MoveJ {
            origin: OperationId("op-j".to_string()),
            target: vec![0.5, 0.5],
            max_velocity: Some(50.0),
            max_acceleration: Some(1000.0),
        };
        let materializer = DepartureReparameterizer::new(20.0, 500.0);
        let segments = materializer
            .materialize(&proposal(ActionKind::Singularity), &segment)
            .expect("must materialize");
        match &segments[0] {
            MotionSegment::MoveJ {
                max_velocity,
                max_acceleration,
                ..
            } => {
                assert_eq!(*max_velocity, Some(50.0), "never downgrade velocity");
                assert_eq!(*max_acceleration, Some(1000.0), "never downgrade acceleration");
            }
            other => panic!("expected MoveJ, got {other:?}"),
        }
    }

    #[test]
    fn singularity_detour_perturbs_movej_target() {
        // Spec causal-remediation "Interior singularity uses joint-space
        // perturbation": the edit SHALL perturb the joint configuration away
        // from singularity.
        let materializer = SingularityDetourMaterializer::new(DEFAULT_PERTURBATION);
        let segments = materializer
            .materialize(&proposal(ActionKind::Singularity), &movej(vec![0.5, -0.3, 0.1]))
            .expect("detour must materialize a MoveJ");
        assert_eq!(segments.len(), 1);
        match &segments[0] {
            MotionSegment::MoveJ { target, .. } => {
                assert_ne!(target, &vec![0.5, -0.3, 0.1], "target joints must be perturbed");
                for (original, perturbed) in [0.5, -0.3, 0.1].iter().zip(target.iter()) {
                    assert!(
                        ((perturbed - original) - DEFAULT_PERTURBATION).abs() < 1e-12,
                        "each joint must be displaced by the perturbation delta"
                    );
                }
            }
            other => panic!("expected MoveJ, got {other:?}"),
        }
    }

    #[test]
    fn singularity_detour_rejects_movel() {
        // Interior MoveL remediation is a documented gap (M4 property suite):
        // a Cartesian segment carries no joint target to perturb.
        let materializer = SingularityDetourMaterializer::new(DEFAULT_PERTURBATION);
        match materializer.materialize(&proposal(ActionKind::Singularity), &move_l()) {
            Err(MaterializationError::UnsupportedSegment) => {}
            other => panic!("expected UnsupportedSegment, got {other:?}"),
        }
    }

    #[test]
    fn strategy_carries_departure_limits_for_start_anchored_regions() {
        // The advisor routes a start-anchored region to the Departure
        // strategy carrying precomputed limits; interior regions carry the
        // Detour perturbation.
        let robot = chain(RobotModel::Scara);
        let start = vec![0.0, 0.0, 0.0, 0.0];
        let target = vec![0.5, -0.3, -0.1, 0.0];
        let (v, a) = departure_limits(&robot, &start, &target, TIME_STEP);

        let strategy = SingularityStrategy::Departure {
            max_velocity: v,
            max_acceleration: a,
        };
        match strategy {
            SingularityStrategy::Departure {
                max_velocity: sv,
                max_acceleration: sa,
            } => {
                assert_eq!(sv, v);
                assert_eq!(sa, a);
                assert!(sa > 0.0);
            }
            other => panic!("expected Departure strategy, got {other:?}"),
        }
    }

    // ── P1 (4R R1-1 / R4-2): physical limits respected + causal preservation ──
    //
    // The departure operator computed limits with NO upper bound (up to ~1667
    // rad/s² / ~61 rad/s on real geometry) that flowed verbatim into the
    // plan's MoveJConfig. P1 clamps them to a per-robot physical envelope AND
    // re-verifies the causal goal on the clamped profile: the repair must
    // STILL remove the singular condition — a clamp that produces a trajectory
    // which no longer exits the cone is forbidden (reparación causal → clamp →
    // trayectoria que ya no sale del cono). When the physics cannot clear the
    // cone within the envelope, the operator returns `None` and the
    // recommendation degrades honestly to `Unavailable` — never a
    // clamped-but-failing edit.

    #[test]
    fn physical_envelope_is_per_robot_with_named_ceilings() {
        // P1 limit source: the envelope is per-robot (a SCARA and a Planar3R
        // have different actuation ceilings), keyed by the chain's
        // actuated-joint signature — the only robot identity the planner
        // holds (`SerialChain` carries no `RobotModel`). Unknown chains
        // (URDF-loaded robots) fall back to the conservative generic ceiling.
        use thalos_core::robot::joint::JointKind::{Prismatic, Revolute};

        assert_eq!(
            PhysicalEnvelope::for_signature(4, &[Revolute, Revolute, Prismatic, Revolute]),
            PhysicalEnvelope { max_velocity: 25.0, max_acceleration: 600.0 },
            "SCARA ceiling"
        );
        assert_eq!(
            PhysicalEnvelope::for_signature(3, &[Revolute, Revolute, Revolute]),
            PhysicalEnvelope { max_velocity: 30.0, max_acceleration: 900.0 },
            "Planar3R / Manipulator3DOF ceiling"
        );
        assert_eq!(
            PhysicalEnvelope::for_signature(2, &[Revolute, Revolute]),
            PhysicalEnvelope { max_velocity: 20.0, max_acceleration: 500.0 },
            "Planar2R ceiling"
        );
        assert_eq!(
            PhysicalEnvelope::for_signature(1, &[Revolute]),
            PhysicalEnvelope { max_velocity: 15.0, max_acceleration: 400.0 },
            "SingleRevolute ceiling"
        );
        assert_eq!(
            PhysicalEnvelope::for_signature(0, &[]),
            PhysicalEnvelope { max_velocity: 15.0, max_acceleration: 400.0 },
            "unknown signature must fall back to the conservative generic ceiling"
        );
        // The per-robot requirement: SCARA and Planar3R MUST differ.
        let scara = PhysicalEnvelope::for_chain(&chain(RobotModel::Scara));
        let p3r = PhysicalEnvelope::for_chain(&chain(RobotModel::Planar3R));
        assert_ne!(scara, p3r, "the envelope must be per-robot, never a global constant");
        assert!(scara.max_acceleration < p3r.max_acceleration);
    }

    #[test]
    fn clamped_departure_limits_clamps_both_limits_and_still_clears_the_cone() {
        // Causal-preservation contract, clamp-bite case: the departure
        // [0,0,0] → [0.45, 0.1, 0.0] needs IDEAL limits ~34.5 rad/s / ~939
        // rad/s² — both above the Planar3R envelope (30 / 900). The clamp must
        // bring BOTH inside the envelope AND the clamped profile must still
        // clear the singular cone within the departure window (the repair
        // keeps its causal goal).
        let robot = chain(RobotModel::Planar3R);
        let start = vec![0.0, 0.0, 0.0];
        let target = vec![0.45, 0.1, 0.0];
        let envelope = PhysicalEnvelope::for_chain(&robot);

        let (ideal_v, ideal_a) = departure_limits(&robot, &start, &target, TIME_STEP);
        assert!(
            ideal_v > envelope.max_velocity && ideal_a > envelope.max_acceleration,
            "precondition: the ideal limits must exceed the envelope, got v={ideal_v} a={ideal_a} vs {envelope:?}"
        );

        let (v, a) = clamped_departure_limits(&robot, &start, &target, TIME_STEP)
            .expect("the clamped departure must still clear the cone");
        assert!(
            v <= envelope.max_velocity && a <= envelope.max_acceleration,
            "the clamp must respect the envelope, got v={v} a={a}"
        );
        assert_cone_cleared(&robot, &start, &target, v, a);
    }

    #[test]
    fn clamped_departure_limits_preserves_the_m3_causal_scenarios() {
        // The permanent usability scenarios (24→1 Planar3R, 17→0 Scara) must
        // keep passing: their ideal limits (~22.5 rad/s / ~448 rad/s² and
        // ~17.4 rad/s / ~269 rad/s², measured on the real Jacobians) are
        // INSIDE the envelope, so the clamp is a no-op AND the causal
        // clearance within ≤3 waypoints is preserved.
        let scenarios = [
            (
                RobotModel::Planar3R,
                vec![0.0, 0.0, 0.0],
                vec![0.5, -0.3, 0.1],
            ),
            (
                RobotModel::Scara,
                vec![0.0, 0.0, 0.0, 0.0],
                vec![0.5, -0.3, -0.1, 0.0],
            ),
        ];
        for (model, start, target) in scenarios {
            let robot = chain(model);
            let envelope = PhysicalEnvelope::for_chain(&robot);
            let (v, a) = clamped_departure_limits(&robot, &start, &target, TIME_STEP)
                .expect("the documented M3 departures must remain repairable");
            assert!(v <= envelope.max_velocity && a <= envelope.max_acceleration);
            assert_cone_cleared(&robot, &start, &target, v, a);
        }
    }

    #[test]
    fn clamped_departure_limits_returns_none_when_physics_cannot_clear_the_cone() {
        // The 4R finding (R1-1) distilled: the straight-extension departure
        // [0,0,0] → [0.5, 0.0, 0.0] keeps the WHOLE line inside the cone —
        // ideal a ≈ 1667 rad/s², v ≈ 61 rad/s, NO upper bound on the old
        // code. The clamped profile cannot reach the cone exit within the
        // departure window, so the operator MUST return `None` — never a
        // clamped-but-failing edit that looks valid but does not remove the
        // singular condition.
        let robot = chain(RobotModel::Planar3R);
        let start = vec![0.0, 0.0, 0.0];
        let target = vec![0.5, 0.0, 0.0];

        let (ideal_v, ideal_a) = departure_limits(&robot, &start, &target, TIME_STEP);
        assert!(
            ideal_a > 1500.0,
            "precondition: the ideal acceleration must far exceed the envelope, got {ideal_a}"
        );
        assert!(
            ideal_v > 50.0,
            "precondition: the ideal velocity must far exceed the envelope, got {ideal_v}"
        );

        assert_eq!(
            clamped_departure_limits(&robot, &start, &target, TIME_STEP),
            None,
            "when the clamped profile cannot clear the cone, the operator must return None"
        );
    }

    #[test]
    fn clamped_departure_limits_never_exceeds_the_envelope_across_geometries() {
        // Triangulation: for a spread of departures on both catalog robots,
        // the operator either returns None (the physics genuinely cannot
        // clear the cone — the ideal limits exceed the envelope) or limits
        // inside the envelope that still clear the cone. A None without an
        // envelope violation would mask a bug.
        let cases: Vec<(RobotModel, Vec<f64>, Vec<f64>)> = vec![
            (RobotModel::Planar3R, vec![0.0, 0.0, 0.0], vec![0.5, -0.3, 0.1]),
            (RobotModel::Planar3R, vec![0.0, 0.0, 0.0], vec![0.45, 0.1, 0.0]),
            (RobotModel::Planar3R, vec![0.0, 0.0, 0.0], vec![2.0, -1.0, 0.5]),
            (RobotModel::Planar3R, vec![0.0, 0.0, 0.0], vec![0.5, 0.0, 0.0]),
            (RobotModel::Planar3R, vec![0.0, 0.0, 0.0], vec![0.6, 0.1, 0.0]),
            (
                RobotModel::Scara,
                vec![0.0, 0.0, 0.0, 0.0],
                vec![0.5, -0.3, -0.1, 0.0],
            ),
            (
                RobotModel::Scara,
                vec![0.0, 0.0, 0.0, 0.0],
                vec![1.5, -0.8, -0.3, 0.5],
            ),
        ];
        for (model, start, target) in cases {
            let robot = chain(model);
            let envelope = PhysicalEnvelope::for_chain(&robot);
            match clamped_departure_limits(&robot, &start, &target, TIME_STEP) {
                Some((v, a)) => {
                    assert!(v > 0.0 && a > 0.0, "clamped limits must be positive");
                    assert!(
                        v <= envelope.max_velocity && a <= envelope.max_acceleration,
                        "clamped limits must respect the envelope (v={v} a={a} vs {envelope:?})"
                    );
                    assert_cone_cleared(&robot, &start, &target, v, a);
                }
                None => {
                    let (ideal_v, ideal_a) =
                        departure_limits(&robot, &start, &target, TIME_STEP);
                    assert!(
                        ideal_v > envelope.max_velocity || ideal_a > envelope.max_acceleration,
                        "None without an envelope violation would mask a bug \
                         (ideal v={ideal_v} a={ideal_a} vs {envelope:?})"
                    );
                }
            }
        }
    }
}
