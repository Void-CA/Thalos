use crate::analysis::workspace::Workspace;
use crate::kinematics::jacobian::{JacobianSolver, ManipulabilityReport, SingularityReport};

use super::report::{ManipulabilityAnalysis, ManipulabilitySample};

/// Stateless analyzer that derives manipulability for every sample
/// in a [`Workspace`].
///
/// Internally calls `SingularityReport::analyze` (SVD) and then derives
/// `ManipulabilityReport` from the singular values — no redundant SVD.
pub struct ManipulabilityAnalyzer;

impl ManipulabilityAnalyzer {
    pub fn analyze(
        workspace: &Workspace,
        jacobian_solver: &impl JacobianSolver,
    ) -> ManipulabilityAnalysis {
        let samples: Vec<ManipulabilitySample> = workspace
            .samples()
            .iter()
            .map(|ws_sample| {
                let q = &ws_sample.q;
                let jacobian = jacobian_solver.evaluate(q);
                let singularity = SingularityReport::analyze(&jacobian);
                let manipulability = ManipulabilityReport::compute(&singularity);

                ManipulabilitySample {
                    q: q.clone(),
                    position: ws_sample.position,
                    singularity,
                    manipulability,
                }
            })
            .collect();

        ManipulabilityAnalysis::from_samples(samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::workspace::{WorkspaceConfig, WorkspaceSampler};
    use crate::kinematics::jacobian::GeometricJacobian;
    use crate::kinematics::forward::ForwardKinematics;
    use crate::math::geometry::vectors::Vector3;
    use crate::math::geometry::vectors::UnitVector3;
    use crate::math::geometry::rigid::Transform3D;
    use crate::robot::builder::SerialChainBuilder;
    use crate::robot::joint::*;
    use crate::robot::link::Link;
    use crate::robot::segment::Segment;
    use crate::robot::serial_chain::SerialChain;
    use crate::spatial::frame::FrameId;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::f64::consts::PI;

    fn build_planar_2r() -> (SerialChain, GeometricJacobian) {
        let mut builder = SerialChainBuilder::new();
        let shoulder = builder.create_frame("shoulder");
        let ee = builder.create_frame("ee");

        let joint1 = JointType::Revolute(RevoluteJoint::new(
            0, UnitVector3::z_axis(), JointLimits::new(-PI, PI), Transform3D::identity(),
        ));
        let link1 = Link::new(0, Transform3D::from_translation(Vector3::new(1.0, 0.0, 0.0)));
        builder.add_segment(Segment::new(FrameId::World, shoulder.clone(), joint1, link1));

        let joint2 = JointType::Revolute(RevoluteJoint::new(
            1, UnitVector3::z_axis(), JointLimits::new(-PI, PI), Transform3D::identity(),
        ));
        let link2 = Link::new(1, Transform3D::from_translation(Vector3::new(1.0, 0.0, 0.0)));
        builder.add_segment(Segment::new(shoulder, ee.clone(), joint2, link2));

        builder.set_end_effector(ee.clone());
        let chain = builder.build().expect("planar 2R");
        let fk = ForwardKinematics::new(chain.clone());
        let jac = GeometricJacobian::new(fk, ee);
        (chain, jac)
    }

    #[test]
    fn analyze_planar_2r() {
        let (chain, jac) = build_planar_2r();
        let mut rng = StdRng::seed_from_u64(42);
        let ws = WorkspaceSampler
            .sample(&chain, WorkspaceConfig { samples: 100, seed: 42, tolerance: 1e-3 }, &mut rng)
            .expect("sampling failed");

        let analysis = ManipulabilityAnalyzer::analyze(&ws, &jac);
        assert_eq!(analysis.metrics.total_samples, 100);
        assert_eq!(analysis.samples.len(), 100);

        // All samples should have valid manipulability
        for s in &analysis.samples {
            assert!(s.manipulability.yoshikawa >= 0.0);
            assert!(s.manipulability.isotropy >= 0.0);
            assert!(s.manipulability.isotropy <= 1.0);
        }

        println!(
            "Planar 2R: avg_yoshikawa={:.4}, avg_isotropy={:.4}",
            analysis.metrics.avg_yoshikawa, analysis.metrics.avg_isotropy,
        );
    }
}
