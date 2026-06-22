use crate::kinematics::forward::ForwardKinematics;
use crate::kinematics::jacobian::{
    Jacobian,
    JacobianSolver,
};

use crate::math::algebra::DynamicMatrix;

use crate::math::traits::products::Cross;
use crate::robot::joint::JointKind;

use crate::spatial::frame::FrameId;

pub struct GeometricJacobian {
    fk: ForwardKinematics,
    end_effector: FrameId,
}

impl GeometricJacobian {

    pub fn new(
        fk: ForwardKinematics,
        end_effector: FrameId,
    ) -> Self {
        Self {
            fk,
            end_effector,
        }
    }
}

impl JacobianSolver for GeometricJacobian {

    fn evaluate(&self, q: &[f64]) -> Jacobian {

        let result = self.fk.evaluate(q);

        let robot = self.fk.robot();

        let n_dof: usize = robot.segments.iter()
            .map(|s| s.joint.dof())
            .sum();

        let mut linear = DynamicMatrix::zeros(3, n_dof);

        let mut angular = DynamicMatrix::zeros(3, n_dof);

        // Pose global del end-effector
        let ee_pose = result.pose(&self.end_effector)
                                .expect("End effector pose not found");

        let p_e =
            ee_pose.transform().translation;

        let mut col = 0;

        for segment in robot.segments.iter() {

            // Fixed joint: no contribuye al Jacobiano
            if segment.joint.dof() == 0 {
                continue;
            }

            // Pose global del parent
            let parent_pose =
                result.pose(&segment.parent)
                    .expect("Parent pose not found");

            // Frame real del joint:
            // parent * origin
            let joint_transform =
                parent_pose
                    .transform()
                    .compose(segment.joint.origin());

            let p_i =
                joint_transform.translation;

            let z_i =
                segment
                    .joint
                    .axis_world(&joint_transform);

            match segment.joint.kind() {

                JointKind::Revolute | JointKind::Continuous => {

                    let linear_part =
                        z_i.cross(p_e - p_i);

                    linear[(0, col)] =
                        linear_part.x;

                    linear[(1, col)] =
                        linear_part.y;

                    linear[(2, col)] =
                        linear_part.z;

                    angular[(0, col)] =
                        z_i.x;

                    angular[(1, col)] =
                        z_i.y;

                    angular[(2, col)] =
                        z_i.z;
                }

                JointKind::Prismatic => {

                    linear[(0, col)] =
                        z_i.x;

                    linear[(1, col)] =
                        z_i.y;

                    linear[(2, col)] =
                        z_i.z;

                    // angular = 0
                }

                JointKind::Fixed | JointKind::Floating | JointKind::Planar => {
                    // no debe llegar acá (filtrado arriba)
                }
            }

            col += 1;
        }

        Jacobian::new(linear, angular)
    }
}