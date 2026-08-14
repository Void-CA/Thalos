//! PR4 counterfactual demo (task 6.1) — the polished defense deliverable.
//!
//! The demo runs the FULL candidate pipeline on the SAME real scenario the
//! feasibility test proved (PR3): a middle-segment crossing on the real Scara
//! chain with the real IK solver, real analyzer, real aggregator and the
//! frozen `Assessor`. Its PRIMARY output is the ranked table printed with
//! `-- --nocapture` — the shape the design's demo table specifies.
//!
//! ```text
//! strategy               risk  quality  singular  dur(s)  manip  cost  status
//! Direct               0.5571  0.4429    2       7.818  0.4585 1.0000 admissible
//! AlternateElbow       0.1625  0.8375    0       5.256  0.6314 0.0000 admissible
//! SELECTED: AlternateElbow — risk 0.1625 vs 0.5571 | endpoints/task preserved | reason derived
//! ```
//!
//! The test asserts BEHAVIORAL invariants only — never a fixed golden number:
//!
//! 1. **Seed baseline**: the seed (Direct) assesses HIGH (crisp risk > 0.5) —
//!    the middle-segment crossing passes through full extension.
//! 2. **Counterfactual**: at least one GENERATED alternative is admissible
//!    and strictly lower-risk than the seed.
//! 3. **Equivalence class**: every admissible candidate preserves the
//!    endpoints `|q_cand − q_seed| ≤ ε` per joint (ADR-1) and the task
//!    sequence (compacted `(kind, origin)` runs).
//! 4. **Selection**: the selected candidate's cost `J ≤` the Direct baseline's
//!    J, and the `SelectionReason` is DERIVED (non-empty metric comparison vs
//!    Direct) — no hand-written text, no LLM.
//! 5. **Baseline equivalence (reviewer requirement)**: the Direct candidate's
//!    Assessment equals the plain seed assessment — risk, quality, evidence
//!    (report metrics) and trace (compiled trajectory, waypoint by waypoint).
//!    The Direct candidate IS the seed program, so its compile→analyze→assess
//!    path IS the plain path; the candidates mechanism cannot change it.
//!
//! ## Scenario
//!
//! ```text
//! [MoveJ home (0.0, -1.31, -0.1, 0.0)  →  MoveJ cross (0.5, 0.6, -0.15, 0.0)
//!   →  MoveJ goal (0.5, -1.31, -0.15, 0.0)],  target_segment = 1
//! ```
//!
//! Segment 1's joint-space straight line crosses the full extension (q1 passes
//! through 0) — the localized singularity event that assesses HIGH (crisp risk
//! 0.557). `AlternateElbow` re-solves that segment from the segment-start
//! joints to the SAME-side elbow posture (same cartesian position, q1 stays
//! negative → no crossing) while preserving the head MoveJ and the joint goal.
//!
//! ## Middle-segment requirement (documented finding)
//!
//! The crossing MUST be a middle segment: the gate's endpoint invariant
//! (ADR-1) compares the joint goal — the LAST `MoveJ` target — and
//! `AlternateElbow` changes the joint goal of the segment it transforms. A
//! single-segment crossing program's only generated alternative is therefore
//! structurally rejected (EndpointDrift). The demo uses the three-segment
//! structure the feasibility test proved — no numbers are tuned.
//!
//! ## Deliberate duplication note
//!
//! The real-pipeline harness below mirrors `tests/candidate_feasibility.rs`
//! (the PR3 verification artifact). The harness is duplicated, not extracted,
//! so PR4 touches NO file from the PR3 slice — rollback stays "delete the demo
//! file + docs" (tasks.md). Extracting `tests/common/` is a follow-up refactor.
//!
//! Run: `cargo test -p thalos-planning --test candidate_counterfactual -- --nocapture`

use thalos_collision::NaiveCollisionChecker;
use thalos_core::{
    analysis::{
        Aggregator,
        aggregator::DefaultAggregator,
        observation::{ArtifactRef, ObservationKind},
        scoring::DefaultScoringPolicy,
    },
    collision::CollisionMatrix,
    ids::{MotionPlanId, OperationId},
    kinematics::{forward::ForwardKinematics, inverse::DampedLeastSquaresSolver},
    models::{RobotModel, RobotRegistry},
    motion::segment::MotionSegment,
    prelude::RobotState,
    robot::serial_chain::SerialChain,
    trajectory::Trajectory,
};
use thalos_intelligence::{Assessor, Risk};
use thalos_planning::{
    analysis::TrajectoryAnalyzer,
    candidate::{
        AdmissibilityGate, CandidateAssessment, CandidateEvaluator, CandidateGenerationContext,
        CandidateGenerator, ENDPOINT_TOLERANCE, GateCandidate, JointBounds, MotionMetrics,
        NoCandidateReason, ObjectiveProfile, RiskAdmissibility, SelectionReason, StrategyKind,
        StrategyOutcome,
    },
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
        program::PlanningProgram,
    },
};

// ── Real-pipeline harness (same shape as tests/assessment_demo.rs and
//    tests/candidate_feasibility.rs — see the duplication note above) ───────

fn chain(model: RobotModel) -> SerialChain {
    RobotRegistry::create_default(model)
}

fn real_solver(chain: &SerialChain) -> DampedLeastSquaresSolver {
    let fk = ForwardKinematics::new(chain.clone());
    DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 500, 1e-6, 0.1)
}

fn compile(
    chain: &SerialChain,
    start: &[f64],
    program: &PlanningProgram,
) -> Result<Trajectory, String> {
    let solver = real_solver(chain);
    let state = RobotState::new(start.to_vec());
    let ctx = SegmentPlanningContext {
        robot: chain,
        current_state: &state,
        ik_solver: &solver,
        tcp: None,
    };
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
    compiler
        .compile(program, &ctx)
        .map(|p| p.merged_trajectory)
        .map_err(|e| e.to_string())
}

fn analyze(
    chain: &SerialChain,
    trajectory: &Trajectory,
) -> thalos_core::analysis::report::AnalysisReport {
    let checker = NaiveCollisionChecker;
    let matrix = CollisionMatrix::new();
    let analyzer = TrajectoryAnalyzer::new(chain, None).with_collision_checker(&checker, &matrix);
    let artifact = ArtifactRef::MotionPlan(MotionPlanId("counterfactual".to_string()));
    let (analysis, observations) = analyzer
        .analyze_with_observations(artifact.clone(), trajectory)
        .expect("real analysis must succeed");
    DefaultAggregator::new(DefaultScoringPolicy).aggregate_with_metrics(
        artifact,
        observations,
        analysis.metrics.to_btree_map(),
    )
}

fn movej(origin: &str, target: Vec<f64>) -> MotionSegment {
    MotionSegment::MoveJ {
        origin: OperationId(origin.to_string()),
        target,
        max_velocity: None,
        max_acceleration: None,
    }
}

// ── THE RUNTIME ADAPTER — replicated verbatim (design ADR-5) ────────────────

/// The runtime's mapping `Assessment → CandidateAssessment` (design ADR-5):
/// crisp risk = `1 − quality` and the CATEGORICAL verdict
/// `Risk::Critical → Rejected`, everything else Accepted. NO numeric
/// threshold — the Assessor is the single authority on "Critical".
fn map_assessment(assessment: &thalos_intelligence::Assessment) -> CandidateAssessment {
    CandidateAssessment {
        risk: 1.0 - assessment.quality,
        admissibility: match assessment.risk {
            Risk::Critical => RiskAdmissibility::Rejected,
            _ => RiskAdmissibility::Accepted,
        },
    }
}

/// The runtime's `MotionMetrics` extraction: duration / path_length from the
/// analyzed trajectory, avg_manipulability from the technical analysis.
fn extract_metrics(
    trajectory: &Trajectory,
    analysis: &thalos_planning::analysis::PlanAnalysis,
) -> MotionMetrics {
    MotionMetrics {
        duration: trajectory.duration(),
        avg_manipulability: analysis.metrics.avg_manipulability.unwrap_or(0.0),
        // Joint-space L2 path length, the TraceAnalyzer convention (design).
        path_length: trajectory
            .waypoints()
            .windows(2)
            .map(|w| {
                w[1].joints()
                    .iter()
                    .zip(w[0].joints().iter())
                    .map(|(a, b)| (a - b).powi(2))
                    .sum::<f64>()
                    .sqrt()
            })
            .sum(),
    }
}

/// Joint bounds for the gate, from the chain's actuated joints (limits.enabled
/// gates the closed interval; unlimited joints degrade to ±π — the OPERATIONAL
/// fallback convention, NOT a physical range claim).
fn joint_bounds(chain: &SerialChain) -> Vec<JointBounds> {
    chain
        .segments
        .iter()
        .filter(|s| s.joint.dof() > 0)
        .map(|s| {
            let limits = s.joint.limits();
            if limits.enabled {
                JointBounds {
                    lower: limits.min,
                    upper: limits.max,
                }
            } else {
                JointBounds {
                    lower: -std::f64::consts::PI,
                    upper: std::f64::consts::PI,
                }
            }
        })
        .collect()
}

/// The compacted task sequence `(kind, origin)` — the gate's task-identity
/// invariant, re-verified independently here.
fn compact_task(program: &PlanningProgram) -> Vec<(&'static str, String)> {
    let mut runs: Vec<(&'static str, String)> = Vec::new();
    for segment in &program.segments {
        let kind = match segment {
            MotionSegment::MoveJ { .. } => "MoveJ",
            MotionSegment::MoveL { .. } => "MoveL",
            MotionSegment::MoveLPosition { .. } => "MoveLPosition",
        };
        let key = (kind, segment.origin().0.clone());
        match runs.last() {
            Some(last) if *last == key => {}
            _ => runs.push(key),
        }
    }
    runs
}

/// The first commanded MoveJ and the joint goal (last MoveJ target) of a
/// program — the gate's endpoint pair (ADR-1), re-verified independently.
fn commanded_endpoints(program: &PlanningProgram) -> (Option<Vec<f64>>, Option<Vec<f64>>) {
    let first = program.segments.iter().find_map(|s| match s {
        MotionSegment::MoveJ { target, .. } => Some(target.clone()),
        _ => None,
    });
    let goal = program.segments.iter().rev().find_map(|s| match s {
        MotionSegment::MoveJ { target, .. } => Some(target.clone()),
        _ => None,
    });
    (first, goal)
}

fn endpoints_within_epsilon(seed: &PlanningProgram, candidate: &PlanningProgram) -> bool {
    let (s_first, s_goal) = commanded_endpoints(seed);
    let (c_first, c_goal) = commanded_endpoints(candidate);
    let within = |seed: Option<&[f64]>, cand: Option<&[f64]>| match (seed, cand) {
        (None, None) => true,
        (Some(s), Some(c)) => {
            s.len() == c.len()
                && s.iter()
                    .zip(c.iter())
                    .all(|(qs, qc)| (qc - qs).abs() <= ENDPOINT_TOLERANCE)
        }
        _ => false,
    };
    within(s_first.as_deref(), c_first.as_deref()) && within(s_goal.as_deref(), c_goal.as_deref())
}

// ── The composed pipeline ────────────────────────────────────────────────────

struct PipelineOutcome {
    seed_assessment: thalos_intelligence::Assessment,
    seed_report: thalos_core::analysis::report::AnalysisReport,
    /// The seed's compiled trajectory (the plain path's trace).
    seed_trajectory: Trajectory,
    ranking: thalos_planning::candidate::CandidateRanking,
    admissible: Vec<thalos_planning::candidate::AdmissibleCandidate>,
    rejected: Vec<thalos_planning::candidate::RejectedCandidate>,
    candidates: Vec<thalos_planning::candidate::Candidate>,
    /// The FULL strategy trace (every strategy → Generated/Skipped) — the
    /// ADR-3 observability data the ranking now carries.
    traces: Vec<thalos_planning::candidate::StrategyTrace>,
    /// Per-candidate compiled trajectory (index-aligned with `candidates`).
    trajectories: Vec<Option<Trajectory>>,
    /// Per-candidate analysis report (index-aligned with `candidates`).
    reports: Vec<Option<thalos_core::analysis::report::AnalysisReport>>,
}

fn run_pipeline(seed: &PlanningProgram, home: &[f64], target_segment: usize) -> PipelineOutcome {
    let robot = chain(RobotModel::Scara);
    let solver = real_solver(&robot);
    let generator = CandidateGenerator::default();
    let ctx = CandidateGenerationContext { target_segment };

    // 1. Generate (Direct is always candidate 0 — the seed itself). The FULL
    //    trace is carried into the ranking (ADR-3), never dropped.
    let (candidates, traces) = generator.generate(seed, &ctx, &solver);

    // 2. Per candidate: compile → analyze → assess → map (the runtime adapter).
    let mut gate_rows: Vec<GateCandidate> = Vec::new();
    let mut trajectories: Vec<Option<Trajectory>> = Vec::new();
    let mut reports: Vec<Option<thalos_core::analysis::report::AnalysisReport>> = Vec::new();
    for candidate in &candidates {
        match compile(&robot, home, &candidate.program) {
            Ok(trajectory) => {
                let report = analyze(&robot, &trajectory);
                let assessment = Assessor::assess(&report);
                let neutral = map_assessment(&assessment);
                let (analysis, _obs) = {
                    let checker = NaiveCollisionChecker;
                    let matrix = CollisionMatrix::new();
                    let analyzer = TrajectoryAnalyzer::new(&robot, None)
                        .with_collision_checker(&checker, &matrix);
                    let artifact =
                        ArtifactRef::MotionPlan(MotionPlanId("counterfactual".to_string()));
                    analyzer
                        .analyze_with_observations(artifact, &trajectory)
                        .expect("analysis must succeed")
                };
                gate_rows.push(GateCandidate {
                    candidate: candidate.clone(),
                    compile_ok: true,
                    assessment: Some(neutral),
                    metrics: Some(extract_metrics(&trajectory, &analysis)),
                });
                trajectories.push(Some(trajectory));
                reports.push(Some(report));
            }
            Err(_) => {
                gate_rows.push(GateCandidate {
                    candidate: candidate.clone(),
                    compile_ok: false,
                    assessment: None,
                    metrics: None,
                });
                trajectories.push(None);
                reports.push(None);
            }
        }
    }

    // The seed's OWN path (the plain assessment): compile → analyze → assess.
    let seed_trajectory = compile(&robot, home, seed).expect("seed must compile");
    let seed_report = analyze(&robot, &seed_trajectory);
    let seed_assessment = Assessor::assess(&seed_report);

    // 3. Gate (two phases: geometric invariants, then the risk policy).
    let bounds = joint_bounds(&robot);
    let report = AdmissibilityGate.filter(seed, &gate_rows, Some(&bounds));

    // 4. Rank (argmin J over the admissible set only). The ranking carries
    //    the full strategy trace (ADR-3 observability).
    let ranking = CandidateEvaluator::evaluate(
        &report.admissible,
        ObjectiveProfile::SafetyFirst,
        traces.clone(),
    );

    PipelineOutcome {
        seed_assessment,
        seed_report,
        seed_trajectory,
        ranking,
        admissible: report.admissible,
        rejected: report.rejected,
        candidates,
        traces,
        trajectories,
        reports,
    }
}

fn score_of<'a>(
    ranking: &'a thalos_planning::candidate::CandidateRanking,
    candidate: &thalos_planning::candidate::Candidate,
) -> Option<&'a thalos_planning::candidate::CandidateScore> {
    ranking
        .ranked
        .iter()
        .find(|(c, _)| c == candidate)
        .map(|(_, s)| s)
}

// ── The ranked table — the demo's PRIMARY output (design demo table shape) ──

fn print_ranked_table(outcome: &PipelineOutcome, title: &str) {
    println!("\n{:=^90}", format!(" {} ", title));
    let seed = &outcome.seed_assessment;
    println!(
        "SEED (Direct)   verdict={:?}  crisp_risk={:.4}  quality={:.4}  singular={}  near_singular={}",
        seed.risk,
        1.0 - seed.quality,
        seed.quality,
        outcome
            .seed_report
            .metrics
            .get("singular_count")
            .copied()
            .unwrap_or(0.0),
        outcome
            .seed_report
            .metrics
            .get("near_singular_count")
            .copied()
            .unwrap_or(0.0),
    );
    println!(
        "{:<18} {:>8} {:>8} {:>10} {:>9} {:>13} {:>8}   status",
        "strategy", "risk", "quality", "singular", "dur(s)", "manip", "cost"
    );
    for (i, row) in outcome.candidates.iter().enumerate() {
        let admissible = outcome.admissible.iter().find(|a| a.candidate == *row);
        let rejected = outcome.rejected.iter().find(|r| r.candidate == *row);
        let singular = outcome.reports[i]
            .as_ref()
            .and_then(|r| r.metrics.get("singular_count"))
            .copied()
            .unwrap_or(0.0);
        let (risk, quality, duration, manip, cost, status) = match (admissible, rejected) {
            (Some(a), _) => (
                a.assessment.risk,
                1.0 - a.assessment.risk,
                a.metrics.duration,
                a.metrics.avg_manipulability,
                score_of(&outcome.ranking, &a.candidate)
                    .map(|s| s.cost)
                    .unwrap_or(f64::NAN),
                "admissible".to_string(),
            ),
            (None, Some(r)) => (
                r.assessment.as_ref().map(|a| a.risk).unwrap_or(f64::NAN),
                r.assessment
                    .as_ref()
                    .map(|a| 1.0 - a.risk)
                    .unwrap_or(f64::NAN),
                0.0,
                0.0,
                f64::NAN,
                format!("rejected: {:?}", r.reason),
            ),
            (None, None) => (
                f64::NAN,
                f64::NAN,
                0.0,
                0.0,
                f64::NAN,
                "no verdict".to_string(),
            ),
        };
        println!(
            "{:<18} {:>8.4} {:>8.4} {:>10} {:>9.3} {:>13.4} {:>8.4}   {}",
            format!("{:?}", row.strategy),
            risk,
            quality,
            singular,
            duration,
            manip,
            cost,
            status
        );
    }
    // The design demo table's SELECTED line: strategy — risk comparison |
    // endpoints/task preserved | reason derived.
    match &outcome.ranking.reason {
        SelectionReason::Selected {
            strategy,
            metric_comparison,
            ..
        } => {
            let direct_risk = outcome
                .admissible
                .iter()
                .find(|a| a.candidate.strategy == StrategyKind::Direct)
                .map(|a| a.assessment.risk)
                .unwrap_or(f64::NAN);
            let selected_risk = outcome
                .admissible
                .iter()
                .find(|a| a.candidate.strategy == *strategy)
                .map(|a| a.assessment.risk)
                .unwrap_or(f64::NAN);
            println!(
                "SELECTED: {:?} — risk {:.4} vs {:.4} | endpoints/task preserved | reason derived",
                strategy, selected_risk, direct_risk
            );
            // The derived reason's content (for the defense): the metric
            // comparison vs Direct the reason was built from.
            println!(
                "  derived reason: {}",
                metric_comparison
                    .iter()
                    .map(|m| format!(
                        "{}: {:.4} vs {:.4}",
                        m.component, m.selected_value, m.baseline_value
                    ))
                    .collect::<Vec<_>>()
                    .join(" | ")
            );
        }
        SelectionReason::NoAdmissibleCandidate { reason } => {
            println!("SELECTED: none — {reason}");
        }
    }
    println!("{:=^90}", "");
}

// ── Scenario: the crossing program (three segments, crossing in the middle) ─

fn crossing_seed() -> PlanningProgram {
    PlanningProgram::new(vec![
        movej("op-home", vec![0.0, -1.31, -0.1, 0.0]),
        movej("op-cross", vec![0.5, 0.6, -0.15, 0.0]),
        movej("op-goal", vec![0.5, -1.31, -0.15, 0.0]),
    ])
}

fn home() -> Vec<f64> {
    vec![0.0, -1.31, -0.1, 0.0]
}

/// Waypoint-by-waypoint equality of two compiled trajectories (the executed
/// articulation trace): same count, same joints per waypoint, same timestamps.
fn trajectories_equal(a: &Trajectory, b: &Trajectory) -> bool {
    let (wa, wb) = (a.waypoints(), b.waypoints());
    wa.len() == wb.len()
        && wa.iter().zip(wb.iter()).all(|(pa, pb)| {
            pa.joints().len() == pb.joints().len()
                && (pa.timestamp() - pb.timestamp()).abs() <= 1e-12
                && pa
                    .joints()
                    .iter()
                    .zip(pb.joints().iter())
                    .all(|(qa, qb)| (qa - qb).abs() <= 1e-12)
        })
}

// ── THE COUNTERFACTUAL DEMO — behavioral invariants, never golden numbers ───

#[test]
fn counterfactual_demo_middle_segment_crossing() {
    let seed = crossing_seed();
    let outcome = run_pipeline(&seed, &home(), 1);

    print_ranked_table(
        &outcome,
        "COUNTERFACTUAL DEMO — MIDDLE-SEGMENT CROSSING (target_segment = 1)",
    );

    // ── 0. Baseline equivalence (reviewer requirement) — the Direct
    //    candidate's Assessment MUST equal the plain seed assessment:
    //    risk, quality, evidence (report metrics), trace (trajectory). ──────
    let seed_risk = 1.0 - outcome.seed_assessment.quality;
    let direct = outcome
        .admissible
        .iter()
        .find(|a| a.candidate.strategy == StrategyKind::Direct)
        .expect("the Direct seed must be admissible against itself");
    // risk + quality: the Direct row's mapped assessment == the seed's crisp.
    assert!(
        (direct.assessment.risk - seed_risk).abs() <= 1e-12,
        "Direct candidate risk {:.6} MUST equal the plain seed risk {:.6}",
        direct.assessment.risk,
        seed_risk
    );
    assert!(
        ((1.0 - direct.assessment.risk) - outcome.seed_assessment.quality).abs() <= 1e-12,
        "Direct candidate quality MUST equal the plain seed quality"
    );
    // evidence: the Direct row's analysis report == the seed's own report
    // (identical singular/near-singular counts, manipulability, waypoints…).
    let direct_report = outcome.reports[0].as_ref().expect("Direct must compile");
    assert_eq!(
        direct_report.metrics, outcome.seed_report.metrics,
        "the Direct candidate's evidence (report metrics) MUST equal the \
         plain seed report's"
    );
    // trace: the Direct candidate's executed trajectory == the seed's,
    // waypoint by waypoint (joints + timestamps).
    let direct_trajectory = outcome.trajectories[0]
        .as_ref()
        .expect("Direct must compile");
    assert!(
        trajectories_equal(direct_trajectory, &outcome.seed_trajectory),
        "the Direct candidate's trajectory trace MUST equal the seed's"
    );
    assert_eq!(
        direct.assessment.admissibility,
        RiskAdmissibility::Accepted,
        "the Direct seed must pass the risk policy (not Critical)"
    );
    println!(
        "BASELINE EQUIVALENCE: Direct candidate == plain seed (risk {:.4}, quality {:.4}, evidence, trace) — PASS",
        direct.assessment.risk,
        1.0 - direct.assessment.risk
    );

    // ── 1. The seed (Direct) is assessed HIGH ──────────────────────────────
    assert_eq!(
        outcome.candidates[0].strategy,
        StrategyKind::Direct,
        "the seed must always be candidate 0 (Direct)"
    );
    assert_eq!(
        outcome.candidates[0].program, seed,
        "Direct IS the seed program"
    );
    assert!(
        seed_risk > 0.5,
        "the crossing seed must assess with crisp risk > 0.5, got {seed_risk:.4}"
    );
    assert!(
        outcome
            .seed_report
            .observations
            .iter()
            .any(|o| o.kind == ObservationKind::Singularity
                || o.kind == ObservationKind::NearSingularity),
        "the crossing seed must carry singularity observations from the real analyzer"
    );
    assert!(
        direct.assessment.risk > 0.5,
        "the mapped Direct assessment must reflect the High seed, got {:.4}",
        direct.assessment.risk
    );

    // ── 2. At least one GENERATED alternative is admissible and strictly
    //    lower-risk than the seed ───────────────────────────────────────────
    let generated_admissible: Vec<_> = outcome
        .admissible
        .iter()
        .filter(|a| a.candidate.strategy != StrategyKind::Direct)
        .collect();
    assert!(
        !generated_admissible.is_empty(),
        "at least one generated alternative must pass both gate phases — \
         rejected rows: {:?}",
        outcome
            .rejected
            .iter()
            .map(|r| (format!("{:?}", r.candidate.strategy), r.reason))
            .collect::<Vec<_>>()
    );
    let better = generated_admissible
        .iter()
        .find(|a| a.assessment.risk + 1e-12 < seed_risk)
        .expect("an admissible generated alternative must beat the seed's risk");
    println!(
        "COUNTERFACTUAL: generated {:?} admissible with risk {:.4} < seed {:.4} — PASS",
        better.candidate.strategy, better.assessment.risk, seed_risk
    );

    // ── 3. Equivalence class: endpoints ≤ ε per joint + task sequence
    //    preserved for EVERY admissible candidate ───────────────────────────
    for admissible in &outcome.admissible {
        assert!(
            endpoints_within_epsilon(&seed, &admissible.candidate.program),
            "admissible candidate {:?} must preserve endpoints within ε = {ENDPOINT_TOLERANCE}",
            admissible.candidate.strategy
        );
        assert_eq!(
            compact_task(&seed),
            compact_task(&admissible.candidate.program),
            "admissible candidate {:?} must preserve the task sequence",
            admissible.candidate.strategy
        );
    }
    println!(
        "EQUIVALENCE CLASS: endpoints ≤ ε and task sequence preserved for {} admissible — PASS",
        outcome.admissible.len()
    );

    // ── 4. Selection: cost ≤ Direct cost + DERIVED reason ──────────────────
    let selected = outcome
        .ranking
        .selected
        .as_ref()
        .expect("a selection must exist");
    let selected_score = score_of(&outcome.ranking, selected).expect("selected is ranked");
    let direct_score = score_of(&outcome.ranking, &direct.candidate).expect("Direct is ranked");
    assert!(
        selected_score.cost <= direct_score.cost + 1e-9,
        "the selection must cost ≤ the Direct baseline: selected J {:.4} vs Direct J {:.4}",
        selected_score.cost,
        direct_score.cost
    );
    match &outcome.ranking.reason {
        SelectionReason::Selected {
            metric_comparison,
            endpoints,
            task,
            ..
        } => {
            assert!(
                !metric_comparison.is_empty(),
                "the derived reason must carry the metric comparison vs Direct"
            );
            assert_eq!(*endpoints, "Endpoints: preserved");
            assert_eq!(*task, "Task: preserved");
        }
        other => panic!("expected a Selected reason, got {other:?}"),
    }
    println!(
        "SELECTION: {:?} J {:.4} ≤ Direct J {:.4} | reason derived — PASS",
        selected.strategy, selected_score.cost, direct_score.cost
    );

    // ── 5. The headline ────────────────────────────────────────────────────
    println!(
        "\nCOUNTERFACTUAL VERDICT: seed (Direct) risk {seed_risk:.4} -> selected {:?} risk {:.4}, J {:.4} vs Direct J {:.4} — {}",
        selected.strategy,
        selected_score.risk,
        selected_score.cost,
        direct_score.cost,
        if selected_score.risk + 1e-12 < seed_risk
            && selected_score.cost <= direct_score.cost + 1e-9
        {
            "COMPONENT CONTRIBUTES: selection beats the seed on the real scenario"
        } else {
            "selection matches the seed (see table)"
        }
    );
    let _ = better; // used by the counterfactual assert above
}

// ── REMEDIATION (verify reviewer contract test) — the executable thesis ─────

#[test]
fn candidate_selection_preserves_task_and_improves_assessed_trajectory() {
    // The end-to-end CONTRACT, asserted on the REAL scenario the feasibility
    // and counterfactual tests proved (middle-segment crossing `[MoveJ home,
    // MoveJ cross, MoveJ goal]`, target_segment = 1, Scara). The harness
    // walks the exact defended flow with NO mocks: seed → generate (Direct +
    // InsertWaypoint + AlternateElbow) → compile each → analyze each → assess
    // each (frozen `Assessor`) → admissibility gate → objective ranking →
    // selection → derived reason.
    //
    // Assertions are SEMANTIC (frozen values with tolerances, never fragile
    // internals): the numbers below are real geometry output, not tuned.
    let seed = crossing_seed();
    let outcome = run_pipeline(&seed, &home(), 1);
    let ranking = &outcome.ranking;

    // 1. Generation ran: the seed is candidate 0 and the ranking exists.
    assert_eq!(
        outcome.candidates[0].strategy,
        StrategyKind::Direct,
        "the seed must always be candidate 0"
    );
    assert_eq!(outcome.candidates[0].program, seed, "Direct IS the seed");

    // 2. Baseline exists: the ranking contains Direct (the immutable baseline).
    let direct = outcome
        .admissible
        .iter()
        .find(|a| a.candidate.strategy == StrategyKind::Direct)
        .expect("the Direct baseline must be in the ranking");
    assert!(
        ranking
            .ranked
            .iter()
            .any(|(c, _)| c.strategy == StrategyKind::Direct),
        "Direct must be ranked"
    );

    // 3. An alternative exists: the ranking contains AlternateElbow.
    let alternate = outcome
        .admissible
        .iter()
        .find(|a| a.candidate.strategy == StrategyKind::AlternateElbow)
        .expect("AlternateElbow must be admissible and ranked");
    assert!(
        ranking
            .ranked
            .iter()
            .any(|(c, _)| c.strategy == StrategyKind::AlternateElbow),
        "AlternateElbow must be ranked"
    );

    // 4. The Assessor actually DIFFERENTIATED the candidates (intelligence
    //    layer engaged): the crossing through full extension must assess
    //    strictly riskier than the same-side-elbow realization — by a
    //    meaningful margin, not by chance.
    assert!(
        direct.assessment.risk > alternate.assessment.risk + 0.1,
        "the Assessor must differentiate: Direct {:.4} vs AlternateElbow {:.4}",
        direct.assessment.risk,
        alternate.assessment.risk
    );

    // 5. Geometry improved: the alternative's manipulability is higher.
    assert!(
        alternate.metrics.avg_manipulability > direct.metrics.avg_manipulability,
        "the alternative must improve manipulability: {:.4} vs {:.4}",
        alternate.metrics.avg_manipulability,
        direct.metrics.avg_manipulability
    );

    // 6. The selected candidate is admissible (both gate phases passed).
    let selected = ranking.selected.as_ref().expect("a selection must exist");
    assert!(
        outcome.admissible.iter().any(|a| &a.candidate == selected),
        "the selected candidate must be admissible"
    );

    // 7. Same task: Direct and the selected share the task signature
    //    (compacted kind/origin runs — the equivalence class).
    assert_eq!(
        compact_task(&seed),
        compact_task(&selected.program),
        "the selected candidate must preserve the task sequence"
    );

    // 8. Same endpoints: |q_candidate − q_seed| ≤ ε per joint (ADR-1).
    assert!(
        endpoints_within_epsilon(&seed, &selected.program),
        "the selected candidate must preserve endpoints within ε = {ENDPOINT_TOLERANCE}"
    );

    // 9. Selection is the MATHEMATICAL consequence: per the proven scenario
    //    the selected strategy is AlternateElbow and its cost is strictly
    //    below the Direct baseline's.
    assert_eq!(
        selected.strategy,
        StrategyKind::AlternateElbow,
        "the objective must select the strictly-better alternative"
    );
    let selected_score = score_of(ranking, selected).expect("the selected is ranked");
    let direct_score = score_of(ranking, &direct.candidate).expect("Direct is ranked");
    assert!(
        selected_score.cost < direct_score.cost,
        "the selected cost must be strictly lower than Direct's: J {:.4} vs {:.4}",
        selected_score.cost,
        direct_score.cost
    );

    // 10. Reason derived: the `SelectionReason` metric comparison includes
    //     risk, duration, manipulability, length AND cost.
    let components: Vec<&str> = match &ranking.reason {
        SelectionReason::Selected {
            metric_comparison, ..
        } => metric_comparison
            .iter()
            .map(|m| m.component.as_str())
            .collect(),
        other => panic!("expected a Selected reason, got {other:?}"),
    };
    for required in ["risk", "duration", "manipulability", "length", "cost"] {
        assert!(
            components.contains(&required),
            "the derived reason must compare {required}, got {components:?}"
        );
    }

    // 11. Singularity semantics: Direct crossed full extension (singular > 0),
    //     the selected same-side-elbow realization has none (singular == 0).
    let direct_singular = outcome.reports[0]
        .as_ref()
        .and_then(|r| r.metrics.get("singular_count"))
        .copied()
        .unwrap_or(0.0);
    let selected_idx = outcome
        .candidates
        .iter()
        .position(|c| c == selected)
        .expect("the selected candidate must be one of the generated rows");
    let selected_singular = outcome.reports[selected_idx]
        .as_ref()
        .and_then(|r| r.metrics.get("singular_count"))
        .copied()
        .unwrap_or(0.0);
    assert!(
        direct_singular > 0.0,
        "the crossing seed must carry singular waypoints, got {direct_singular}"
    );
    assert_eq!(
        selected_singular, 0.0,
        "the selected realization must have no singular waypoints"
    );

    // 12. Verdict semantics: Direct assessed High (crisp > 0.5), the selected
    //     assessed Low (crisp < 0.25) — with tolerance; the categorical
    //     verdict enum agrees with the crisp buckets.
    let direct_crisp = 1.0 - outcome.seed_assessment.quality;
    assert!(
        direct_crisp > 0.5,
        "the crossing seed must assess High, got {direct_crisp:.4}"
    );
    assert_eq!(
        outcome.seed_assessment.risk,
        Risk::High,
        "the seed verdict must be High"
    );
    let selected_assessment = Assessor::assess(
        outcome.reports[selected_idx]
            .as_ref()
            .expect("selected must compile"),
    );
    let selected_crisp = 1.0 - selected_assessment.quality;
    assert!(
        selected_crisp < 0.25,
        "the alternative must assess Low, got {selected_crisp:.4}"
    );
    assert_eq!(
        selected_assessment.risk,
        Risk::Low,
        "the alternative verdict must be Low"
    );

    // ── Baseline equivalence IN THE SAME SCENARIO (planning level) ─────────
    // Direct IS the seed program, so its compile→analyze→assess path IS the
    // plain path. The Direct row's mapped neutral risk must equal an
    // INDEPENDENT `Assessor::assess` of the same report; the evidence (report
    // metrics) and the executed trajectory (trace) must be identical. (The
    // literal `analyze_plan` vs `analyze_plan_with_candidates` structural
    // equality lives at the runtime level — `candidates_flow_preserves_the_
    // seed_assessment_and_report`; the planning crate cannot depend on the
    // runtime crate.)
    let seed_risk = 1.0 - outcome.seed_assessment.quality;
    assert!(
        (direct.assessment.risk - seed_risk).abs() <= 1e-12,
        "the Direct row {:.6} MUST equal the independent seed assessment {:.6}",
        direct.assessment.risk,
        seed_risk
    );
    let direct_report = outcome.reports[0].as_ref().expect("Direct must compile");
    assert_eq!(
        direct_report.metrics, outcome.seed_report.metrics,
        "the Direct candidate's evidence (report metrics) MUST equal the plain seed's"
    );
    let direct_trajectory = outcome.trajectories[0]
        .as_ref()
        .expect("Direct must compile");
    assert!(
        trajectories_equal(direct_trajectory, &outcome.seed_trajectory),
        "the Direct candidate's trajectory trace MUST equal the plain seed's"
    );

    // ── The strategy trace is carried, not dropped (ADR-3 observability) ──
    assert_eq!(
        outcome.traces.len(),
        3,
        "Direct + the two generating strategies"
    );
    assert_eq!(outcome.traces[0].strategy, StrategyKind::Direct);
    assert!(matches!(
        outcome.traces[0].outcome,
        StrategyOutcome::Generated(_)
    ));
    assert_eq!(outcome.traces[1].strategy, StrategyKind::InsertWaypoint);
    assert!(matches!(
        outcome.traces[1].outcome,
        StrategyOutcome::Skipped(NoCandidateReason::UnsupportedSegment)
    ));
    assert_eq!(outcome.traces[2].strategy, StrategyKind::AlternateElbow);
    assert!(matches!(
        outcome.traces[2].outcome,
        StrategyOutcome::Generated(_)
    ));
    assert_eq!(
        ranking.strategy_trace, outcome.traces,
        "the ranking must carry the full strategy trace"
    );

    println!(
        "CONTRACT TEST: Direct (High, risk {:.4}, singular {:.0}) vs selected {:?} \
         (Low, risk {:.4}, singular {:.0}) — manip {:.4} > {:.4}, J {:.4} < {:.4}, \
         task+endpoints preserved, reason derived (risk/duration/manipulability/length/cost), \
         trace carried — PASS",
        direct.assessment.risk,
        direct_singular,
        selected.strategy,
        selected_score.risk,
        selected_singular,
        alternate.metrics.avg_manipulability,
        direct.metrics.avg_manipulability,
        selected_score.cost,
        direct_score.cost,
    );
}
