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

        let result =
            self.fk.evaluate(q);

        let robot =
            self.fk.robot();

        let n =
            robot.segments.len();

        let mut linear =
            DynamicMatrix::zeros(3, n);

        let mut angular =
            DynamicMatrix::zeros(3, n);

        // Pose global del end-effector
        let ee_pose =
            result.pose(&self.end_effector)
                .expect("End effector pose not found");

        let p_e =
            ee_pose.transform().translation;

        for (i, segment) in robot.segments.iter().enumerate() {

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

            // eje local del joint
            let axis_local =
                segment.joint.axis();

            // eje expresado globalmente
            let z_i =
                joint_transform
                    .rotation
                    .rotate_vector(axis_local.into_inner());

            match segment.joint.kind() {

                JointKind::Revolute => {

                    let linear_part =
                        z_i.cross(p_e - p_i);

                    linear[(0, i)] =
                        linear_part.x;

                    linear[(1, i)] =
                        linear_part.y;

                    linear[(2, i)] =
                        linear_part.z;

                    angular[(0, i)] =
                        z_i.x;

                    angular[(1, i)] =
                        z_i.y;

                    angular[(2, i)] =
                        z_i.z;
                }

                JointKind::Prismatic => {

                    linear[(0, i)] =
                        z_i.x;

                    linear[(1, i)] =
                        z_i.y;

                    linear[(2, i)] =
                        z_i.z;

                    // angular = 0
                }
            }
        }

        Jacobian::new(linear, angular)
    }
}