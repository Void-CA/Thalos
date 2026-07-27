mod pbm;

use pbm::scenarios::*;
use pbm::run_scenario;

#[test]
fn joint_limit_scenario() {
    run_scenario(&JointLimitScenario);
}

#[test]
fn near_singularity_scenario() {
    run_scenario(&NearSingularityScenario);
}

#[test]
fn velocity_violation_scenario() {
    run_scenario(&VelocityViolationScenario);
}

#[test]
fn coarse_sampling_scenario() {
    run_scenario(&CoarseSamplingScenario);
}

#[test]
fn orientation_constraint_scenario() {
    run_scenario(&OrientationConstraintScenario);
}

#[test]
fn mixed_scenario() {
    run_scenario(&MixedScenario);
}
