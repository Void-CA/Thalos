type JointLimits = (f64, f64);
pub trait Joint {
    fn transform(&self, q : f64) -> Transform;
    fn limits(&self) -> JointLimits;
    fn axis(&self) -> Vector3;
}
