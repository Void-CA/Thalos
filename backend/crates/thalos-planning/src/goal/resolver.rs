use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        inverse::{IKGoal, IKStatus},
        jacobian::{GeometricJacobian, JacobianSolver, ManipulabilityReport, SingularityReport},
    },
    spatial::pose::Pose,
};

use thalos_core::robot::state::RobotState;

use crate::{
    error::{IkFailureReason, PlanningError},
    motion::planner::PlanningContext,
};

use super::policy::PlanningPolicy;
use super::types::{GoalMetadata, JointGoal, MetricAction, ResolvedPoseGoal, ValidatedGoal};

#[derive(Debug, Clone)]
pub struct GoalResolverConfig {
    pub policy: PlanningPolicy,
    pub check_joint_limits: bool,
    pub strict_limits: bool,
}

impl Default for GoalResolverConfig {
    fn default() -> Self {
        Self {
            policy: PlanningPolicy::default(),
            check_joint_limits: true,
            strict_limits: true,
        }
    }
}

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
    ) -> Result<ValidatedGoal<ResolvedPoseGoal>, PlanningError> {
        let ik_result = ctx
            .ik_solver
            .solve(ctx.current_state.as_slice(), IKGoal::Pose(pose.clone()))?;

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

        let q = &ik_result.q;
        self.enrich_metadata(ctx, q, &mut metadata);
        let assessment = self.config.policy.evaluate(&metadata);

        Ok(ValidatedGoal {
            goal: ResolvedPoseGoal {
                pose: pose.clone(),
                state: RobotState::new(ik_result.q),
            },
            metadata,
            assessment,
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

        self.enrich_metadata(ctx, target, &mut metadata);
        let assessment = self.config.policy.evaluate(&metadata);

        Ok(ValidatedGoal {
            goal: JointGoal(target.to_vec()),
            metadata,
            assessment,
        })
    }

    /// Populate metadata with singularity/manipulability when at least one
    /// policy metric is active. Avoids paying SVD cost when everything is `Ignore`.
    fn enrich_metadata(&self, ctx: &PlanningContext, q: &[f64], metadata: &mut GoalMetadata) {
        let active = !matches!(
            (
                self.config.policy.singularity,
                self.config.policy.manipulability
            ),
            (MetricAction::Ignore, MetricAction::Ignore)
        );

        if active {
            if let Some((singularity, manipulability)) = self.analyze_configuration(ctx, q) {
                metadata.singularity = Some(singularity);
                metadata.manipulability = Some(manipulability);
            }
        }
    }

    fn validate_joint_limits(&self, ctx: &PlanningContext, q: &[f64]) -> Result<(), PlanningError> {
        let mut joint_idx = 0;
        for segment in &ctx.robot.segments {
            if segment.joint.dof() == 0 {
                continue;
            }
            let limits = segment.joint.limits();

            // Joints without mechanical bounds (e.g. URDF continuous
            // without an explicit <limit>) cannot violate limits.
            if !limits.enabled {
                joint_idx += 1;
                continue;
            }

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
        let jac_solver = if let Some(tcp) = ctx.tcp {
            GeometricJacobian::with_tcp(fk, tcp.clone())
        } else {
            let ee = ctx.robot.end_effector().clone();
            GeometricJacobian::new(fk, ee)
        };
        let jacobian = jac_solver.evaluate(q);
        let singularity = SingularityReport::analyze(&jacobian);
        let manipulability = ManipulabilityReport::compute(&singularity);
        Some((singularity, manipulability))
    }
}
