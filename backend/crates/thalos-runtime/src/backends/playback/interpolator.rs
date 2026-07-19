use std::sync::Arc;
use std::time::Duration;

use crate::motion_trace::{MotionSample, MotionTrace};
use crate::state::robot_state::{
    ConnectionState, Diagnostics, ExecutionState, JointState, MotionMode, MotionState, RobotState,
};

/// Método de interpolación entre samples de un MotionTrace.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum InterpolationMethod {
    /// Usar el sample más cercano (sin interpolación).
    NearestSample,
    /// Interpolación lineal entre samples.
    Linear,
}

impl std::fmt::Display for InterpolationMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InterpolationMethod::NearestSample => write!(f, "nearest"),
            InterpolationMethod::Linear => write!(f, "linear"),
        }
    }
}

/// Calcula un RobotState para un tiempo dado a partir de un MotionTrace.
pub trait Interpolator: Send + Sync {
    /// Interpolar el estado del robot en el tiempo `t`.
    fn interpolate(&self, trace: &MotionTrace, t: Duration) -> Arc<RobotState>;

    /// Método de interpolación.
    fn method(&self) -> InterpolationMethod;
}

/// Interpolador que devuelve el sample más cercano.
pub struct NearestSampleInterpolator;

impl NearestSampleInterpolator {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NearestSampleInterpolator {
    fn default() -> Self {
        Self::new()
    }
}

impl Interpolator for NearestSampleInterpolator {
    fn interpolate(&self, trace: &MotionTrace, t: Duration) -> Arc<RobotState> {
        let samples = trace.samples();
        if samples.is_empty() {
            return Arc::new(RobotState::default());
        }

        // Encontrar el sample más cercano
        let idx = samples
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                let da = (a.timestamp.as_secs_f64() - t.as_secs_f64()).abs();
                let db = (b.timestamp.as_secs_f64() - t.as_secs_f64()).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap_or(0);

        sample_to_state(&samples[idx], t)
    }

    fn method(&self) -> InterpolationMethod {
        InterpolationMethod::NearestSample
    }
}

/// Interpolador lineal entre samples.
pub struct LinearInterpolator;

impl LinearInterpolator {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LinearInterpolator {
    fn default() -> Self {
        Self::new()
    }
}

impl Interpolator for LinearInterpolator {
    fn interpolate(&self, trace: &MotionTrace, t: Duration) -> Arc<RobotState> {
        let samples = trace.samples();
        if samples.is_empty() {
            return Arc::new(RobotState::default());
        }

        let t_secs = t.as_secs_f64();

        // Caso: antes del primer sample
        if t_secs <= samples[0].timestamp.as_secs_f64() {
            return sample_to_state(&samples[0], t);
        }

        // Caso: después del último sample
        let last_idx = samples.len() - 1;
        if t_secs >= samples[last_idx].timestamp.as_secs_f64() {
            return sample_to_state(&samples[last_idx], t);
        }

        // Encontrar el par de samples que rodean a t
        let mut hi = 1;
        while hi < samples.len() && samples[hi].timestamp.as_secs_f64() < t_secs {
            hi += 1;
        }
        let lo = hi - 1;

        let t_lo = samples[lo].timestamp.as_secs_f64();
        let t_hi = samples[hi].timestamp.as_secs_f64();
        let frac = if (t_hi - t_lo).abs() < 1e-12 {
            0.0
        } else {
            ((t_secs - t_lo) / (t_hi - t_lo)).clamp(0.0, 1.0)
        };

        let n = samples[lo].joints.len().min(samples[hi].joints.len());
        let joints: Vec<f64> = (0..n)
            .map(|i| samples[lo].joints[i] + (samples[hi].joints[i] - samples[lo].joints[i]) * frac)
            .collect();

        let velocities: Vec<f64> = if samples[lo].velocities.len() == samples[hi].velocities.len()
            && !samples[lo].velocities.is_empty()
        {
            (0..samples[lo].velocities.len())
                .map(|i| {
                    samples[lo].velocities[i]
                        + (samples[hi].velocities[i] - samples[lo].velocities[i]) * frac
                })
                .collect()
        } else {
            vec![]
        };

        let progress = samples[lo].progress + (samples[hi].progress - samples[lo].progress) * frac;

        // Target joints interpolados (opcional)
        let target_joints = match (&samples[lo].target_joints, &samples[hi].target_joints) {
            (Some(a), Some(b)) => {
                let n = a.len().min(b.len());
                Some(
                    (0..n)
                        .map(|i| a[i] + (b[i] - a[i]) * frac)
                        .collect::<Vec<f64>>(),
                )
            }
            _ => None,
        };

        let is_completed = t_secs >= samples.last().unwrap().timestamp.as_secs_f64();

        Arc::new(RobotState {
            joints: JointState {
                positions: joints,
                velocities,
                torques: vec![],
            },
            execution: ExecutionState {
                current_program: None,
                current_segment: None,
                progress,
            },
            motion: MotionState {
                mode: if is_completed {
                    MotionMode::Idle
                } else {
                    MotionMode::Moving
                },
                power_on: true,
                motion_enabled: true,
            },
            connection: ConnectionState::Connected,
            diagnostics: Diagnostics {
                timestamp: chrono::Utc::now(),
                ..Diagnostics::default()
            },
            revision: 0,
            cartesian: crate::state::robot_state::CartesianState::default(),
            devices: crate::state::robot_state::DeviceState::default(),
            errors: Vec::new(),
        })
    }

    fn method(&self) -> InterpolationMethod {
        InterpolationMethod::Linear
    }
}

/// Convertir un MotionSample a RobotState.
fn sample_to_state(sample: &MotionSample, t: Duration) -> Arc<RobotState> {
    let is_last = sample.progress >= 1.0;
    Arc::new(RobotState {
        joints: JointState {
            positions: sample.joints.clone(),
            velocities: sample.velocities.clone(),
            torques: vec![],
        },
        execution: ExecutionState {
            current_program: None,
            current_segment: None,
            progress: sample.progress,
        },
        motion: MotionState {
            mode: if is_last {
                MotionMode::Idle
            } else {
                MotionMode::Moving
            },
            power_on: true,
            motion_enabled: true,
        },
        connection: ConnectionState::Connected,
        diagnostics: Diagnostics {
            timestamp: chrono::Utc::now(),
            ..Diagnostics::default()
        },
        revision: 0,
        cartesian: crate::state::robot_state::CartesianState::default(),
        devices: crate::state::robot_state::DeviceState::default(),
        errors: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_trace() -> MotionTrace {
        let mut trace = MotionTrace::new();
        trace.push(MotionSample {
            timestamp: Duration::from_secs_f64(0.0),
            joints: vec![0.0, 0.0],
            velocities: vec![0.0, 0.0],
            target_joints: None,
            progress: 0.0,
            errors: vec![],
        });
        trace.push(MotionSample {
            timestamp: Duration::from_secs_f64(1.0),
            joints: vec![1.0, 2.0],
            velocities: vec![1.0, 2.0],
            target_joints: None,
            progress: 1.0,
            errors: vec![],
        });
        trace
    }

    #[test]
    fn nearest_sample_at_time_zero() {
        let interp = NearestSampleInterpolator::new();
        let trace = sample_trace();
        let state = interp.interpolate(&trace, Duration::from_secs_f64(0.0));
        assert!((state.joints.positions[0] - 0.0).abs() < 1e-6);
    }

    #[test]
    fn linear_at_midpoint() {
        let interp = LinearInterpolator::new();
        let trace = sample_trace();
        let state = interp.interpolate(&trace, Duration::from_secs_f64(0.5));
        assert!((state.joints.positions[0] - 0.5).abs() < 1e-6);
        assert!((state.joints.positions[1] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn linear_before_first_sample() {
        let interp = LinearInterpolator::new();
        let trace = sample_trace();
        // t negativo, debería devolver el primer sample
        let state = interp.interpolate(&trace, Duration::from_secs_f64(0.0));
        assert!((state.joints.positions[0] - 0.0).abs() < 1e-6);
    }

    #[test]
    fn linear_after_last_sample() {
        let interp = LinearInterpolator::new();
        let trace = sample_trace();
        let state = interp.interpolate(&trace, Duration::from_secs_f64(5.0));
        assert!((state.joints.positions[0] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn empty_trace_returns_default() {
        let interp = LinearInterpolator::new();
        let trace = MotionTrace::new();
        let state = interp.interpolate(&trace, Duration::from_secs_f64(0.0));
        assert!(state.joints.positions.is_empty());
    }
}
