pub fn clean(v: f64) -> f64 {
    if v.abs() < 1e-10 {
        0.0
    } else {
        v
    }
}