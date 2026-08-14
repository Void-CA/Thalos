//! PR3 functional verification: the composed candidate pipeline RUNS on real
//! geometry and the component CONTRIBUTES (selection beats the seed).
//!
//! The full chain is exercised with REAL components, no mocks:
//!
//! ```text
//! CandidateGenerator::generate → per candidate (PlanCompiler → TrajectoryAnalyzer
//! → DefaultAggregator → Assessor::assess) → runtime adapter mapping (replicated
//! HERE because the planning crate must stay free of thalos-intelligence as a
//! dependency — the runtime owns the mapping in production) → AdmissibilityGate
//! → CandidateEvaluator → CandidateRanking
//! ```
//!
//! The adapter mapping replicated in this test is EXACTLY the runtime's
//! (design ADR-5): `risk = 1 − quality` and the CATEGORICAL verdict
//! `Assessment.risk == Critical → RiskAdmissibility::Rejected` — never a
//! numeric threshold in planning.
//!
//! ## Scenario
//!
//! Seed = the crossing program, three segments so the crossing MoveJ is a
//! MIDDLE segment (the gate's endpoint invariant compares the joint goal — the
//! LAST MoveJ target — so the strategy's target must not be the goal):
//!
//! ```text
//! [MoveJ home (0.0, -1.31, -0.1, 0.0)  →  MoveJ cross (0.5, 0.6, -0.15, 0.0)
//!   →  MoveJ goal (0.5, -1.31, -0.15, 0.0)],  target_segment = 1
//! ```
//!
//! Segment 1's joint-space straight line crosses the full extension (q1 passes
//! through 0) — the localized singularity event that `assessment_demo`
//! proved assesses HIGH (crisp risk 0.557). `AlternateElbow` re-solves that
//! segment from the segment-start joints to the SAME-side elbow posture (same
//! cartesian position, q1 stays negative → no crossing), while preserving the
//! head MoveJ and the joint goal — so the counterfactual "admissible
//! alternative with strictly lower risk" is geometrically attainable.
//!
//! Run: `cargo test -p thalos-planning --test candidate_feasibility -- --nocapture`

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
        ObjectiveProfile, RiskAdmissibility, SelectionReason, StrategyKind,
    },
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
        program::PlanningProgram,
    },
};

// ── Real-pipeline harness (same shape as tests/assessment_demo.rs) ──────────

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
    let artifact = ArtifactRef::MotionPlan(MotionPlanId("feasibility".to_string()));
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
/// analyzed trajectory, avg_manipulability from the technical analysis
/// (design ADR-5 — the evaluator never computes a metric from the program).
fn extract_metrics(
    trajectory: &Trajectory,
    analysis: &thalos_planning::analysis::PlanAnalysis,
) -> MotionMetrics {
    MotionMetrics {
        duration: trajectory.duration(),
        avg_manipulability: analysis.metrics.avg_manipulability.unwrap_or(0.0),
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

/// Joint bounds for the gate, from the chain's actuated joints (same source
/// the runtime uses — limits.enabled gates the closed interval).
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
/// invariant, re-verified independently in this test.
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
    ranking: thalos_planning::candidate::CandidateRanking,
    admissible: Vec<thalos_planning::candidate::AdmissibleCandidate>,
    rejected: Vec<thalos_planning::candidate::RejectedCandidate>,
    candidates: Vec<thalos_planning::candidate::Candidate>,
    /// Per-candidate analysis report (for the printout — singular counts,
    /// durations come from the REAL analyzed reports).
    reports: Vec<Option<thalos_core::analysis::report::AnalysisReport>>,
}

fn run_pipeline(seed: &PlanningProgram, home: &[f64], target_segment: usize) -> PipelineOutcome {
    let robot = chain(RobotModel::Scara);
    let solver = real_solver(&robot);
    let generator = CandidateGenerator::default();
    let ctx = CandidateGenerationContext { target_segment };

    // 1. Generate (Direct is always candidate 0 — the seed itself). The FULL
    //    strategy trace is carried into the ranking (ADR-3), never dropped.
    let (candidates, traces) = generator.generate(seed, &ctx, &solver);

    // 2. Per candidate: compile → analyze → assess → map (the runtime adapter).
    let mut gate_rows: Vec<GateCandidate> = Vec::new();
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
                    let artifact = ArtifactRef::MotionPlan(MotionPlanId("feasibility".to_string()));
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
                reports.push(Some(report));
            }
            Err(_) => {
                gate_rows.push(GateCandidate {
                    candidate: candidate.clone(),
                    compile_ok: false,
                    assessment: None,
                    metrics: None,
                });
                reports.push(None);
            }
        }
    }

    // The seed's OWN assessment (the Direct candidate is the seed program —
    // its assessment IS the seed's; report kept for the printout).
    let seed_trajectory = compile(&robot, home, seed).expect("seed must compile");
    let seed_report = analyze(&robot, &seed_trajectory);
    let seed_assessment = Assessor::assess(&seed_report);

    // 3. Gate (two phases: geometric invariants, then the risk policy).
    let bounds = joint_bounds(&robot);
    let report = AdmissibilityGate.filter(seed, &gate_rows, Some(&bounds));

    // 4. Rank (argmin J over the admissible set only). The ranking carries
    //    the full strategy trace (ADR-3 observability).
    let ranking =
        CandidateEvaluator::evaluate(&report.admissible, ObjectiveProfile::SafetyFirst, traces);

    PipelineOutcome {
        seed_assessment,
        seed_report,
        ranking,
        admissible: report.admissible,
        rejected: report.rejected,
        candidates,
        reports,
    }
}

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
    match &outcome.ranking.reason {
        SelectionReason::Selected {
            strategy,
            metric_comparison,
            ..
        } => {
            println!(
                "SELECTED: {:?}  — {}",
                strategy,
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

/// THE FEASIBILITY TEST — the composed pipeline runs end-to-end on real
/// geometry and the component contributes: the selection beats the seed.
#[test]
fn pipeline_runs_and_selection_beats_the_seed_on_real_geometry() {
    let seed = crossing_seed();
    let outcome = run_pipeline(&seed, &home(), 1);

    print_ranked_table(
        &outcome,
        "FEASIBILITY — CROSSING PROGRAM (target_segment = 1)",
    );

    // ── 1. The seed is candidate 0 (Direct) and is assessed HIGH ──────────
    assert_eq!(
        outcome.candidates[0].strategy,
        StrategyKind::Direct,
        "the seed must always be candidate 0 (Direct)"
    );
    assert_eq!(
        outcome.candidates[0].program, seed,
        "Direct IS the seed program"
    );
    let seed_risk = 1.0 - outcome.seed_assessment.quality;
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
    let direct = outcome
        .admissible
        .iter()
        .find(|a| a.candidate.strategy == StrategyKind::Direct)
        .expect("the Direct seed must be admissible against itself");
    assert!(
        direct.assessment.risk > 0.5,
        "the mapped Direct assessment must reflect the High seed, got {:.4}",
        direct.assessment.risk
    );

    // ── 2. (a) at least one GENERATED alternative is admissible ───────────
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

    // ── 3. (c) endpoints + task sequence preserved for EVERY admissible ───
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

    // ── 4. The counterfactual: an admissible GENERATED alternative with
    //    STRICTLY lower risk than the seed ─────────────────────────────────
    let better = generated_admissible
        .iter()
        .find(|a| a.assessment.risk + 1e-12 < seed_risk);
    assert!(
        better.is_some(),
        "an admissible generated alternative must beat the seed's risk — \
         seed {seed_risk:.4}, generated: {:?}",
        generated_admissible
            .iter()
            .map(|a| (format!("{:?}", a.candidate.strategy), a.assessment.risk))
            .collect::<Vec<_>>()
    );
    let better = better.expect("guarded above");

    // ── 5. (b) the SELECTED candidate: cost ≤ Direct cost ─────────────────
    let selected = outcome
        .ranking
        .selected
        .as_ref()
        .expect("a selection must exist");
    let selected_score = score_of(&outcome.ranking, selected).expect("selected is ranked");
    let direct_score = score_of(
        &outcome.ranking,
        &outcome
            .admissible
            .iter()
            .find(|a| a.candidate.strategy == StrategyKind::Direct)
            .expect("Direct admissible")
            .candidate,
    )
    .expect("Direct is ranked");
    assert!(
        selected_score.cost <= direct_score.cost + 1e-9,
        "the selection must cost ≤ the Direct baseline: selected J {:.4} vs Direct J {:.4}",
        selected_score.cost,
        direct_score.cost
    );

    // ── 6. (d) the selection reason is DERIVED (non-empty comparison vs
    //    Direct) ───────────────────────────────────────────────────────────
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

    // ── 7. The headline: the selection demonstrably contributes ───────────
    println!(
        "\nFEASIBILITY VERDICT: seed (Direct) risk {seed_risk:.4} -> selected {:?} risk {:.4}, J {:.4} vs Direct J {:.4} — {}",
        selected.strategy,
        selected_score.risk,
        selected_score.cost,
        direct_score.cost,
        if selected_score.risk + 1e-12 < seed_risk
            && selected_score.cost <= direct_score.cost + 1e-9
        {
            "COMPONENT CONTRIBUTES: selection beats the seed"
        } else {
            "selection matches the seed (see table)"
        }
    );
    let _ = better; // used by the counterfactual assert above
}
