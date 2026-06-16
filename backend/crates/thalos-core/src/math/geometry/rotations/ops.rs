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
    #[test]
    fn test_quaternion_algebra() {
        use super::*;

        let q1 = Quaternion::new(1.2, -3.5, 2.0, -4.0);
        let q2 = Quaternion::new(0.5, 1.0, -1.2, -2.0);

        let q3 = q1 + q2;
        let q4 = q2 - q1;

        println!("Suma:\nQ3: {:?}\n", q3);
        println!("Resta:\nQ4: {:?}\n", q4);


        let q5 =  q4 * q1;
        let q6 = q3 * q4;
        let q7 =  q2 * q1;
        println!("Resultado de multiplicaciones");
        println!("Q5: {:?}", q5);
        println!("Q6: {:?}", q6);

        println!("{:.2} {:.2} {:.2} {:.2}",
            q3.w * q4.w, q3.w * q4.x, q3.w * q4.y, q3.w * q4.z
        );
        println!("{:.2} {:.2} {:.2} {:.2}",
            q3.x * q4.w, q3.x * q4.x, q3.x * q4.y, q3.x * q4.z
        );
        println!("{:.2} {:.2} {:.2} {:.2}",
            q3.y * q4.w, q3.y * q4.x, q3.y * q4.y, q3.y * q4.z
        );
        println!("{:.2} {:.2} {:.2} {:.2}",
            q3.z * q4.w, q3.z * q4.x, q3.z * q4.y, q3.z * q4.z
        );

        println!("Q7: {:?}", q7);
    }

}