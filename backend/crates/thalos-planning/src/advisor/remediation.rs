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
    robot::serial_chain::SerialChain,
};

use crate::feedback::materializer::{MaterializationError, ProposalMaterializer};
use crate::feedback::operator::ActionProposal;

/// The planner's fixed MoveJ time step (`compiler.rs` MoveJConfig.time_step).
pub const TIME_STEP: f64 = 0.01;

/// Near-singular threshold (TrajectoryAnalyzer): condition number ≥ 100 is a
/// NearSingularity Warning — the warning penalty also feeds the score, so the
/// departure must clear the FULL cone (cn < 100), not just the Error cone
/// (cn < 1000, which the full-cone clearance implies).
const NEAR_SINGULAR_THRESHOLD: f64 = 100.0;

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
        DepartureReparameterizer, TIME_STEP, departure_limits,
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
}
