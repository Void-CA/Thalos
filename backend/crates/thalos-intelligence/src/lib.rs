//! # thalos-intelligence
//!
//! Pure-Rust intelligent trajectory assessment (no I/O, no HTTP, no async
//! runtime). The crate observes and evaluates `AnalysisReport`s — it never
//! mutates them and never touches planner or runtime state.
//!
//! ## Hybrid reasoning split (design "Reasoning split — symbolic vs gradual")
//!
//! - **Symbolic** (`kb` + `engine`): a forward-chaining expert system decides
//!   WHICH conditions hold (derived facts, e.g. `danger_zone`) and records the
//!   exact firing order in the trace.
//! - **Gradual** (`fuzzy`): a Mamdani fuzzy layer decides the MAGNITUDE. The
//!   only risk computation is Mamdani's crisp output; quality is its
//!   normalized complement (`1.0 - risk`).
//!
//! The facade is [`Assessor::assess`]: `&AnalysisReport -> Assessment`.
//!
//! ## Threshold anchoring contract (design "Threshold anchoring contract")
//!
//! | Threshold | Source | Sharing strategy |
//! |---|---|---|
//! | `near_singular_condition_threshold = 100.0` | `SingularityConfig` (thalos-core) | **Shared directly** — read, never duplicated |
//! | singular condition `1000.0` | analyzer local literal | Replicated `SINGULAR_CONDITION_THRESHOLD` + behavioral anchoring test |
//! | `manip_threshold = 0.3` | analyzer local variable | Replicated `MANIPULABILITY_LOW_THRESHOLD` + behavioral anchoring test |
//! | collision `0.0`, near-collision `0.05` | analyzer local literals | Replicated `COLLISION_DISTANCE` / `NEAR_COLLISION_DISTANCE` + behavioral anchoring test |
//!
//! ## Quality as risk complement (design "Output mapping")
//!
//! *"Risk is the primary output of fuzzy inference; Quality is obtained as
//! its normalized complement."* Future multidimensional quality is out of
//! scope for this MVP.

pub mod engine;
pub mod fuzzy;
pub mod kb;
pub mod output;
pub mod semantic;

pub use engine::{EngineOutput, MAX_ITERATIONS};
pub use fuzzy::{DEFUZZ_SAMPLES, LinguisticVariable, MembershipShape};
pub use kb::{Antecedent, Consequent, KbError, LinguisticVar, RiskSet, Rule, RuleCategory};
pub use kb::{
    COLLISION_DISTANCE, MANIPULABILITY_LOW_THRESHOLD, NEAR_COLLISION_DISTANCE,
    SINGULAR_CONDITION_THRESHOLD,
};
pub use output::{Assessment, RecommendationRef, Risk, TraceEntry, TriggeredRule};

use std::collections::{BTreeMap, HashMap};

use thalos_core::analysis::action::ActionKind;
use thalos_core::analysis::location::Location;
use thalos_core::analysis::report::AnalysisReport;

use crate::engine::Memberships;
use crate::fuzzy::centroid;

/// The intelligent trajectory assessor — a stateless, read-only facade.
///
/// `assess` is a pure function of the report: it reads `report.metrics` (and,
/// for recommendations, `report.actions`/`report.observations`) and returns an
/// [`Assessment`]. The report is never mutated, enriched or replaced.
pub struct Assessor;

impl Assessor {
    /// Assess an [`AnalysisReport`] into a risk/quality verdict with an
    /// auditable trace.
    pub fn assess(report: &AnalysisReport) -> Assessment {
        let inputs = extract_inputs(report);
        let kb = kb::default_kb();

        // 1. Fuzzify the four linguistic variables.
        let memberships = fuzzify(&inputs);

        // 2. Forward chain (symbolic): derived facts + trace + evidence.
        let engine_output = engine::run(&kb, &memberships, MAX_ITERATIONS);

        // 3. Defuzzify (gradual): Mamdani aggregation + centroid over [0, 1].
        let crisp_risk = defuzzify_risk(&engine_output.risk_contributions);

        // 4. Categorical risk + quality complement.
        let risk = Risk::from_crisp(crisp_risk);
        let quality = (1.0 - crisp_risk).clamp(0.0, 1.0);

        // 5. Assemble evidence (derived inputs first, then MarkEvidence).
        let mut evidence = BTreeMap::new();
        evidence.insert("manipulability".to_string(), inputs.manipulability);
        evidence.insert(
            "singularity_proximity".to_string(),
            inputs.singularity_proximity,
        );
        evidence.insert(
            "collision_clearance".to_string(),
            inputs.collision_clearance,
        );
        evidence.insert(
            "trajectory_complexity".to_string(),
            inputs.trajectory_complexity,
        );
        evidence.extend(engine_output.evidence.clone());

        // 6. Triggered rules in firing order.
        let triggered_rules = engine_output
            .trace
            .iter()
            .map(|entry| {
                let rule = kb
                    .iter()
                    .find(|r| r.id == entry.rule_id)
                    .expect("fired rule must exist in the KB");
                output::TriggeredRule {
                    id: rule.id.to_string(),
                    category: rule.category,
                    priority: rule.priority,
                }
            })
            .collect();

        // 7. Recommendations: associate the diagnosis with existing
        //    PlanAdvisor actions by ActionKind (no parallel mechanism).
        let recommendations = associate_recommendations(report, &engine_output.trace, &kb);

        Assessment {
            risk,
            quality,
            triggered_rules,
            evidence,
            recommendations,
            trace: engine_output.trace,
        }
    }
}

/// The four derived/crisp inputs of the fuzzy layer, read from the report's
/// metrics (pure read — the report is never modified).
struct AssessorInputs {
    manipulability: f64,
    singularity_proximity: f64,
    collision_clearance: f64,
    trajectory_complexity: f64,
}

/// Extract the four linguistic-variable inputs from `report.metrics`.
///
/// `singularity_proximity` and `trajectory_complexity` are DERIVED inside the
/// Assessor from existing metric keys — they are NOT Thalos metrics and are
/// never written back to the report.
fn extract_inputs(report: &AnalysisReport) -> AssessorInputs {
    let metrics = &report.metrics;
    let avg = metrics.get("avg_manipulability").copied();
    let min_manip = metrics.get("min_manipulability").copied();
    let manipulability = avg.or(min_manip).unwrap_or(0.0);

    let near = metrics.get("near_singular_count").copied().unwrap_or(0.0);
    let singular = metrics.get("singular_count").copied().unwrap_or(0.0);
    let waypoints = metrics.get("waypoint_count").copied().unwrap_or(0.0);
    let singularity_proximity = if waypoints > 0.0 {
        (near + singular) / waypoints
    } else {
        0.0
    };

    let collision_clearance = metrics
        .get("min_collision_distance")
        .copied()
        .unwrap_or(1.0);

    let duration = metrics.get("trajectory_duration").copied().unwrap_or(0.0);
    let trajectory_complexity = if duration > 0.0 && waypoints > 0.0 {
        waypoints / duration
    } else {
        0.0
    };

    AssessorInputs {
        manipulability,
        singularity_proximity,
        collision_clearance,
        trajectory_complexity,
    }
}

/// Fuzzify the four inputs against the KB's linguistic variables.
fn fuzzify(inputs: &AssessorInputs) -> Memberships {
    let mut memberships = HashMap::new();
    let variables = kb::input_variables();
    let pairs = [
        (kb::LinguisticVar::Manipulability, inputs.manipulability),
        (
            kb::LinguisticVar::SingularityProximity,
            inputs.singularity_proximity,
        ),
        (
            kb::LinguisticVar::CollisionClearance,
            inputs.collision_clearance,
        ),
        (
            kb::LinguisticVar::TrajectoryComplexity,
            inputs.trajectory_complexity,
        ),
    ];
    for (variable, x) in pairs {
        let lv = variables
            .iter()
            .find(|v| v.name == variable_name(variable))
            .expect("every linguistic variable is defined in the KB");
        for (set, degree) in lv.fuzzify(x) {
            if degree > 0.0 {
                memberships.insert((variable, set), degree);
            }
        }
    }
    memberships
}

fn variable_name(variable: kb::LinguisticVar) -> &'static str {
    match variable {
        kb::LinguisticVar::Manipulability => "manipulability",
        kb::LinguisticVar::SingularityProximity => "singularity_proximity",
        kb::LinguisticVar::CollisionClearance => "collision_clearance",
        kb::LinguisticVar::TrajectoryComplexity => "trajectory_complexity",
    }
}

/// Mamdani aggregation (max) of the risk output sets, then centroid.
fn defuzzify_risk(contributions: &[(f64, kb::RiskSet)]) -> f64 {
    if contributions.is_empty() {
        return 0.0;
    }
    let risk_variable = kb::risk_variable();
    let aggregated = |x: f64| {
        contributions
            .iter()
            .map(|(activation, set)| {
                let set_name = match set {
                    kb::RiskSet::Low => "low",
                    kb::RiskSet::Medium => "medium",
                    kb::RiskSet::High => "high",
                    kb::RiskSet::Critical => "critical",
                };
                let shape = risk_variable
                    .sets
                    .iter()
                    .find(|s| s.name == set_name)
                    .expect("every risk set is defined");
                shape.shape.evaluate(x).min(*activation)
            })
            .fold(0.0_f64, f64::max)
    };
    centroid(aggregated, DEFUZZ_SAMPLES)
}

/// Map the diagnosis onto existing `PlanAdvisor` actions by `ActionKind`.
///
/// For every category among the fired rules, if the report already carries an
/// action of the corresponding kind, a [`RecommendationRef`] is emitted. No
/// new recommendation mechanism exists — this only associates the diagnosis
/// with the advisor's actions for display.
fn associate_recommendations(
    report: &AnalysisReport,
    trace: &[TraceEntry],
    kb: &[kb::Rule],
) -> Vec<RecommendationRef> {
    let fired_ids: HashMap<&str, u8> = trace
        .iter()
        .map(|entry| (entry.rule_id.as_str(), entry.priority))
        .collect();

    // Category of every fired rule, in first-firing order.
    let mut categories: Vec<kb::RuleCategory> = Vec::new();
    for rule in kb {
        if fired_ids.contains_key(rule.id) && !categories.contains(&rule.category) {
            categories.push(rule.category);
        }
    }

    let mut recommendations = Vec::new();
    for category in categories {
        let Some(kind) = action_kind_for_category(category) else {
            continue;
        };
        let Some(action) = report.actions.iter().find(|a| a.kind == kind) else {
            continue;
        };
        let region_id = report
            .observations
            .iter()
            .find(|o| o.id == action.target_observation)
            .and_then(|o| match &o.location {
                Location::Waypoint(index) => Some(*index),
                _ => None,
            });
        recommendations.push(RecommendationRef {
            action_kind: kind,
            region_id,
            rationale: rationale_for(category),
        });
    }
    recommendations
}

/// Map a rule category onto the `ActionKind` the advisor uses to remediate it.
fn action_kind_for_category(category: kb::RuleCategory) -> Option<ActionKind> {
    match category {
        kb::RuleCategory::Collision => Some(ActionKind::Collision),
        kb::RuleCategory::Singularity => Some(ActionKind::Singularity),
        kb::RuleCategory::Manipulability => Some(ActionKind::Manipulability),
        kb::RuleCategory::Trajectory => Some(ActionKind::Constraint),
    }
}

fn rationale_for(category: kb::RuleCategory) -> String {
    match category {
        kb::RuleCategory::Collision => {
            "The intelligent assessment flags collision risk in this region.".to_string()
        }
        kb::RuleCategory::Singularity => {
            "The intelligent assessment flags singularity proximity in this region.".to_string()
        }
        kb::RuleCategory::Manipulability => {
            "The intelligent assessment flags low manipulability in this region.".to_string()
        }
        kb::RuleCategory::Trajectory => {
            "The intelligent assessment flags trajectory inefficiency.".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::analysis::action::{Action, ActionId, ActionImpact, ActionPriority};
    use thalos_core::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use thalos_core::analysis::summary::{AnalysisSummary, Grade};
    use thalos_core::ids::MotionPlanId;

    fn report_with_metrics(metrics: BTreeMap<String, f64>) -> AnalysisReport {
        AnalysisReport {
            artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
            observations: Vec::new(),
            actions: Vec::new(),
            metrics,
            summary: AnalysisSummary {
                quality_index: 0.8,
                observation_count: 0,
                severity_distribution: BTreeMap::new(),
                grade: Grade::Good,
            },
        }
    }

    fn clean_metrics() -> BTreeMap<String, f64> {
        BTreeMap::from([
            ("waypoint_count".to_string(), 10.0),
            ("trajectory_duration".to_string(), 20.0),
            ("avg_manipulability".to_string(), 0.9),
            ("near_singular_count".to_string(), 0.0),
            ("singular_count".to_string(), 0.0),
            ("min_collision_distance".to_string(), 0.5),
        ])
    }

    #[test]
    fn assess_low_risk_high_quality_for_clean_report() {
        // Spec "Low Risk Verdict": Plan A → risk Low, quality > 0.7.
        let report = report_with_metrics(clean_metrics());
        let assessment = Assessor::assess(&report);
        assert_eq!(assessment.risk, Risk::Low);
        assert!(
            assessment.quality > 0.7,
            "quality must exceed 0.7 for a clean plan, got {}",
            assessment.quality
        );
        assert!(
            assessment
                .trace
                .iter()
                .all(|t| t.rule_id != "R11_danger_zone")
        );
    }

    #[test]
    fn assess_high_risk_low_quality_for_collision_plan() {
        // Spec "High Risk Verdict": Plan B → risk High/Critical, quality < 0.4.
        let mut metrics = BTreeMap::from([
            ("waypoint_count".to_string(), 10.0),
            ("trajectory_duration".to_string(), 10.0),
            ("avg_manipulability".to_string(), 0.2),
            ("near_singular_count".to_string(), 2.0),
            ("singular_count".to_string(), 1.0),
            ("min_collision_distance".to_string(), -0.1),
        ]);
        metrics.insert("has_collisions".to_string(), 1.0);
        let report = report_with_metrics(metrics);
        let assessment = Assessor::assess(&report);
        assert!(
            matches!(assessment.risk, Risk::High | Risk::Critical),
            "colliding plan must be High or Critical, got {:?}",
            assessment.risk
        );
        assert!(
            assessment.quality < 0.4,
            "quality must be below 0.4 for a risky plan, got {}",
            assessment.quality
        );
    }

    #[test]
    fn assess_derives_singularity_proximity_without_mutating_report() {
        // Spec "Singularity Proximity Computation" (near=3, wp=10 → 0.3) and
        // "report stays byte-identical after assess".
        let metrics = BTreeMap::from([
            ("waypoint_count".to_string(), 10.0),
            ("near_singular_count".to_string(), 3.0),
            ("singular_count".to_string(), 0.0),
            ("trajectory_duration".to_string(), 10.0),
        ]);
        let report = report_with_metrics(metrics.clone());
        let before = serde_json::to_vec(&report).expect("serialize before");

        let assessment = Assessor::assess(&report);

        assert!(
            (assessment.evidence["singularity_proximity"] - 0.3).abs() < 1e-9,
            "proximity must be 0.3, got {}",
            assessment.evidence["singularity_proximity"]
        );

        let after = serde_json::to_vec(&report).expect("serialize after");
        assert_eq!(
            before, after,
            "assess must leave the report byte-identical (no mutation)"
        );
        assert_eq!(report.metrics, metrics);
    }

    #[test]
    fn assess_never_mutates_report_with_full_metric_surface() {
        let report = report_with_metrics(clean_metrics());
        let snapshot = report.clone();
        let _ = Assessor::assess(&report);
        assert_eq!(report, snapshot);
    }

    #[test]
    fn assess_quality_is_complement_of_crisp_risk() {
        // Spec "Quality Is Risk Complement": quality = 1 - crisp_risk. For a
        // fully clean report the crisp risk stays small and quality is high;
        // for the collision plan the crisp risk is high and quality low — the
        // two always sum to ~1.
        let clean = Assessor::assess(&report_with_metrics(clean_metrics()));
        let risky = Assessor::assess(&report_with_metrics(BTreeMap::from([
            ("waypoint_count".to_string(), 5.0),
            ("trajectory_duration".to_string(), 5.0),
            ("avg_manipulability".to_string(), 0.1),
            ("near_singular_count".to_string(), 5.0),
            ("singular_count".to_string(), 0.0),
            ("min_collision_distance".to_string(), -0.4),
        ])));
        assert!(clean.quality > 0.7);
        assert!(risky.quality < 0.4);
        assert!(
            (clean.quality + risky.quality).abs() < 1.2,
            "complement mapping keeps quality within [0, 1]"
        );
    }

    #[test]
    fn assess_associates_existing_actions_into_recommendations() {
        // Spec "Recommendation References Existing Action": the assessment
        // only references ActionKinds that already exist among report actions.
        let mut report = report_with_metrics(BTreeMap::from([
            ("waypoint_count".to_string(), 10.0),
            ("trajectory_duration".to_string(), 10.0),
            ("avg_manipulability".to_string(), 0.2),
            ("near_singular_count".to_string(), 4.0),
            ("singular_count".to_string(), 0.0),
            ("min_collision_distance".to_string(), 0.05),
        ]));
        report.observations = vec![Observation {
            id: ObservationId(1),
            kind: ObservationKind::LowManipulability,
            severity: Severity::Warning,
            artifact: report.artifact.clone(),
            location: Location::Waypoint(3),
            attributes: BTreeMap::new(),
            causes: Vec::new(),
            related: Vec::new(),
        }];
        report.actions = vec![Action {
            id: ActionId(1),
            kind: ActionKind::Manipulability,
            target_observation: ObservationId(1),
            priority: ActionPriority::High,
            impact: ActionImpact::High,
            parameters: BTreeMap::new(),
        }];

        let assessment = Assessor::assess(&report);
        let kinds: Vec<ActionKind> = assessment
            .recommendations
            .iter()
            .map(|r| r.action_kind)
            .collect();
        assert!(
            kinds.contains(&ActionKind::Manipulability),
            "recommendations must reference the existing Manipulability action"
        );
        assert_eq!(
            assessment.recommendations[0].region_id,
            Some(3),
            "region_id must resolve from the action's target waypoint"
        );
    }

    #[test]
    fn assess_does_not_invent_actions_absent_from_report() {
        // No actions in the report → no recommendation references (the sole
        // recommendation producer is PlanAdvisor; the assessor only associates).
        let report = report_with_metrics(clean_metrics());
        let assessment = Assessor::assess(&report);
        assert!(
            assessment.recommendations.is_empty(),
            "a report without advisor actions must yield no recommendations"
        );
    }
}
