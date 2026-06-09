use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        jacobian::{GeometricJacobian, JacobianSolver, ManipulabilityReport, SingularityReport},
        inverse::{IKGoal, IKStatus},
    },
    spatial::pose::Pose,
};

use crate::{
    error::{IkFailureReason, PlanningError},
    motion::planner::PlanningContext,
};

use super::types::{GoalMetadata, JointGoal, PoseGoal, ValidatedGoal};

#[derive(Debug, Clone)]
pub struct GoalResolverConfig {
    pub check_singularity: bool,
    pub singularity_threshold: f64,
    pub check_joint_limits: bool,
    pub strict_limits: bool,
}

impl Default for GoalResolverConfig {
    fn default() -> Self {
        Self {
            check_singularity: true,
            singularity_threshold: 1000.0,
            check_joint_limits: true,
            strict_limits: true,
        }
    }
}

/// Validates goals and enriches them with singularity/manipulability metadata.
///
/// Singularities are never treated as hard errors — they are reported
/// as metadata so the caller or planner decides how to handle them.
pub struct GoalResolver {
    pub config: GoalResolverConfig,
}

impl GoalResolver {
    pub fn new(config: GoalResolverConfig) -> Self {
        Self { config }
    }

    pub fn resolve_pose(
        &self,
        ctx: &PlanningContext,
        pose: &Pose,
    ) -> Result<ValidatedGoal<PoseGoal>, PlanningError> {
        let ik_result = ctx
            .ik_solver
            .solve(ctx.current_state.as_slice(), IKGoal::Pose(pose.clone()));

        match ik_result.status {
            IKStatus::Converged => {}
            IKStatus::MaxIterations => {
                return Err(PlanningError::IkFailed {
                    target_pose: pose.clone(),
                    reason: IkFailureReason::MaxIterationsReached,
                });
            }
        }

        let mut metadata = GoalMetadata::default();

        if self.config.check_joint_limits {
            self.validate_joint_limits(ctx, &ik_result.q)?;
        }

        if self.config.check_singularity {
            if let Some((singularity, manipulability)) =
                self.analyze_configuration(ctx, &ik_result.q)
            {
                metadata.singularity = Some(singularity);
                metadata.manipulability = Some(manipulability);
            }
        }

        Ok(ValidatedGoal {
            goal: PoseGoal(pose.clone()),
            metadata,
        })
    }

    pub fn resolve_joint(
        &self,
        ctx: &PlanningContext,
        target: &[f64],
    ) -> Result<ValidatedGoal<JointGoal>, PlanningError> {
        let mut metadata = GoalMetadata::default();

        if self.config.check_joint_limits {
            self.validate_joint_limits(ctx, target)?;
        }

        if self.config.check_singularity {
            if let Some((singularity, manipulability)) =
                self.analyze_configuration(ctx, target)
            {
                metadata.singularity = Some(singularity);
                metadata.manipulability = Some(manipulability);
            }
        }

        Ok(ValidatedGoal {
            goal: JointGoal(target.to_vec()),
            metadata,
        })
    }

    fn validate_joint_limits(
        &self,
        ctx: &PlanningContext,
        q: &[f64],
    ) -> Result<(), PlanningError> {
        let mut joint_idx = 0;
        for segment in &ctx.robot.segments {
            if segment.joint.dof() == 0 {
                continue;
            }
            let limits = segment.joint.limits();
            let value = q[joint_idx];

            if self.config.strict_limits {
                if value < limits.min || value > limits.max {
                    return Err(PlanningError::JointLimitViolation {
                        joint_index: joint_idx,
                        value,
                        min: limits.min,
                        max: limits.max,
                    });
                }
            }
            joint_idx += 1;
        }
        Ok(())
    }

    fn analyze_configuration(
        &self,
        ctx: &PlanningContext,
        q: &[f64],
    ) -> Option<(SingularityReport, ManipulabilityReport)> {
        let fk = ForwardKinematics::new(ctx.robot.clone());
        let ee = ctx.robot.end_effector().clone();
        let jac_solver = GeometricJacobian::new(fk, ee);
        let jacobian = jac_solver.evaluate(q);
        let singularity = SingularityReport::analyze(&jacobian);
        let manipulability = ManipulabilityReport::compute(&singularity);
        Some((singularity, manipulability))
    }
}
