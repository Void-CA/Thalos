use serde::{Deserialize, Serialize};

/// Typed output value for `SetOutput` operations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum OutputValue {
    Bool(bool),
    Integer(i32),
    Float(f64),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn output_value_bool() {
        let v = OutputValue::Bool(true);
        assert!(matches!(v, OutputValue::Bool(true)));
    }

    #[test]
    fn output_value_integer() {
        let v = OutputValue::Integer(42);
        assert!(matches!(v, OutputValue::Integer(42)));
    }

    #[test]
    fn output_value_float() {
        let v = OutputValue::Float(0.75);
        assert!(matches!(v, OutputValue::Float(x) if (x - 0.75).abs() < 1e-10));
    }

    #[test]
    fn output_value_serde_round_trip() {
        let cases = vec![
            OutputValue::Bool(true),
            OutputValue::Bool(false),
            OutputValue::Integer(0),
            OutputValue::Integer(-5),
            OutputValue::Float(3.14),
        ];
        for original in cases {
            let json = serde_json::to_string(&original).expect("serialize");
            let deserialized: OutputValue = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(original, deserialized);
        }
    }
}
