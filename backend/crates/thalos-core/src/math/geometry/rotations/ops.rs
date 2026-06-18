use std::ops::{Mul, Add, Sub};
use super::Quaternion;

impl Mul for Quaternion {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self {
        Self {
            w: self.w * rhs.w - self.x * rhs.x - self.y * rhs.y - self.z * rhs.z,
            x: self.w * rhs.x + self.x * rhs.w + self.y * rhs.z - self.z * rhs.y,
            y: self.w * rhs.y - self.x * rhs.z + self.y * rhs.w + self.z * rhs.x,
            z: self.w * rhs.z + self.x * rhs.y - self.y * rhs.x + self.z * rhs.w,
        }
    }
}

impl Add for Quaternion {
    type Output = Self;

    fn add(self, rhs: Self) -> Self {
        Self {
            w: self.w + rhs.w,
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
        }
    }
}

impl Sub for Quaternion {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self {
        Self {
            w: self.w - rhs.w,
            x: self.x - rhs.x,
            y: self.y - rhs.y,
            z: self.z - rhs.z,
        }
    }
}

mod tests {

    use crate::math::geometry::{
        rotations::{Quaternion, UnitQuaternion},
        vectors::{Vector3, UnitVector3}
    };

    #[test]
    fn test_quaternion_algebra() {
        use super::*;

        let q1 = Quaternion::new(2.0, -1.0, 3.0, 4.0);
        let q2 = Quaternion::new(-1.0 ,2.0, -1.0, 3.0);
        let q3 = Quaternion::new(3.0, 1.0, 2.0, -1.0);
        let q4 = Quaternion::new(1.0, -3.0, -2.0, 2.0);


        let q5 = q1 + q2;

        println!("1. q1 + q2:\n {:?}\n", q5);

        let q6 = q3 - q4;

        println!("2. q3 - q4:\n {:?}\n", q6);

        let q_final = (q5 * q6) * q2;
        println!("3. (q1 + q2) * (q3 - q2) * q2:\n {:?}\n", q_final)
    }

    #[test]
    fn test_spatial_rotation() {
        let point = Vector3::new(2.0, -4.0, 4.0);
        let axis = Vector3::new(1.0, 2.0, -2.0);
        let norm = axis.norm();
        let unit_axis = UnitVector3::new(axis).unwrap();

        let angle : f64 = 60.0;
        
        
        println!("Norma: {:?}", norm);
        println!("Vector unitario: {:?}", unit_axis);

        let q = UnitQuaternion::from_axis_angle(
            unit_axis,
            angle.to_radians()
        );
        println!("Q: {:?}", q);
        println!("Q-1 {:?}", q.inverse());

        let p = Quaternion::new(0.0, point.x, point.y, point.z);
        println!("Point as quaternion:\n {:?}", p);
        let w = p * q.into_inner();
        println!("W: {:?}", w);
        println!("Rotated vector: {:?}",  q.rotate_vector(point));

    }
}