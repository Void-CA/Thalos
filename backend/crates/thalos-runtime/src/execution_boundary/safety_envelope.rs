//! Rust mirror of the firmware `SAFETY_ENVELOPE` — parity contract (ADR-1,
//! ADR-5). The values below MUST stay bit-for-bit in sync with
//! `firmware/esp32/src/servo_config.h`; that header is the source of truth.
//! If the firmware envelope changes, this mirror MUST change with it — the
//! backend rejects at the SAME limits the firmware enforces (test 11 parity).

/// Provenance of a limit value — mirrors `enum class LimitSource` in
/// `firmware/esp32/src/servo_config.h`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimitSource {
    /// Declared by the mechanism's URDF model.
    Urdf,
    /// Found by physical measurement/calibration.
    Measured,
    /// Operator/tuning configuration.
    Configured,
    /// Provisional — NOT physically validated yet.
    Temporary,
}

/// Per-channel physical safety envelope — mirrors the `SafetyEnvelope` struct
/// and `SAFETY_ENVELOPE[4]` table in `firmware/esp32/src/servo_config.h`.
///
/// Channel order is joint index order: joint `i` ↔ channel `i` (base 0,
/// elbow 1, wrist 2, prismatic 3). Joints beyond channel 3 (robots with more
/// DOF than the icebot) have NO envelope authority in the firmware — they are
/// unchecked here too (parity).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChannelEnvelope {
    pub position_min_rad: f64,
    pub position_max_rad: f64,
    pub max_velocity_rad_per_s: f64,
    pub position_source: LimitSource,
    pub velocity_source: LimitSource,
}

/// The 4-channel enforcement envelope — THE parity contract. The position and
/// velocity values mirror `SAFETY_ENVELOPE` in `servo_config.h` EXACTLY:
///
/// | Channel | Position (rad) | Velocity (rad/s) | Pos Source | Vel Source |
/// |---------|----------------|------------------|------------|------------|
/// | base (0) | [-1.5708, +1.5708] | 1.0 | URDF | URDF |
/// | elbow (1) | [0.0, +2.0944] | 1.0 | URDF | URDF |
/// | wrist (2) | [-3.1416, +3.1416] | 2.0 | Temporary | Temporary |
/// | prismatic (3) | [0.0, +0.06] | 0.5 | URDF | URDF |
///
/// Wrist is TEMPORARY (not physically validated) exactly like the firmware —
/// do NOT invent a "safer" number without measurement.
pub const SAFETY_ENVELOPE: [ChannelEnvelope; 4] = [
    // base (0): URDF mechanism-safe ±1.5708 rad; velocity URDF 1.0 rad/s.
    ChannelEnvelope {
        position_min_rad: -1.5708,
        position_max_rad: 1.5708,
        max_velocity_rad_per_s: 1.0,
        position_source: LimitSource::Urdf,
        velocity_source: LimitSource::Urdf,
    },
    // elbow (1): URDF 0..2.0944 rad.
    ChannelEnvelope {
        position_min_rad: 0.0,
        position_max_rad: 2.0944,
        max_velocity_rad_per_s: 1.0,
        position_source: LimitSource::Urdf,
        velocity_source: LimitSource::Urdf,
    },
    // wrist (2): TEMPORARY full servo travel ±3.1416 rad.
    ChannelEnvelope {
        position_min_rad: -3.1416,
        position_max_rad: 3.1416,
        max_velocity_rad_per_s: 2.0,
        position_source: LimitSource::Temporary,
        velocity_source: LimitSource::Temporary,
    },
    // prismatic (3): URDF 0..0.06 m (rad fields hold metres).
    ChannelEnvelope {
        position_min_rad: 0.0,
        position_max_rad: 0.06,
        max_velocity_rad_per_s: 0.5,
        position_source: LimitSource::Urdf,
        velocity_source: LimitSource::Urdf,
    },
];

/// Why a joint value was rejected.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ViolationReason {
    /// Position outside [min, max] for the channel.
    Position { min: f64, max: f64 },
    /// Implied velocity Δq/Δt exceeds the channel ceiling.
    Velocity { max: f64 },
}

/// A single joint that violates the envelope (reject, never clamp).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SafetyViolation {
    pub channel: usize,
    pub value: f64,
    pub reason: ViolationReason,
}

impl SafetyViolation {
    /// The firmware validator's diagnostic code for this violation class:
    /// `INVALID_JOINT` matches `firmware/esp32/src/validator.cpp`.
    pub fn diagnostic_code(&self) -> &'static str {
        match self.reason {
            ViolationReason::Position { .. } => "INVALID_JOINT",
            ViolationReason::Velocity { .. } => "VELOCITY_EXCEEDED",
        }
    }
}

impl std::fmt::Display for SafetyViolation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.reason {
            ViolationReason::Position { min, max } => write!(
                f,
                "joint {} at {:.4} rad outside channel envelope [{:.4}, {:.4}]",
                self.channel, self.value, min, max
            ),
            ViolationReason::Velocity { max } => write!(
                f,
                "joint {} implied velocity {:.4} rad/s exceeds channel ceiling {:.4}",
                self.channel, self.value, max
            ),
        }
    }
}

impl std::error::Error for SafetyViolation {}

/// Physical-envelope checks mirroring the firmware validator
/// (`check_physical_envelope`) and executor velocity-bounding (`step_to`).
pub struct SafetyEnvelope;

impl SafetyEnvelope {
    /// Reject any joint outside its channel's position envelope.
    ///
    /// Joint `i` maps to channel `i` of [`SAFETY_ENVELOPE`]. Joints beyond the
    /// 4-channel envelope (robots with more DOF) have no firmware authority
    /// and are left unchecked — parity with the firmware validator.
    pub fn check_joints(joints: &[f64]) -> Result<(), SafetyViolation> {
        for (i, &q) in joints.iter().enumerate() {
            let Some(env) = SAFETY_ENVELOPE.get(i) else {
                continue; // no firmware envelope authority for this channel
            };
            if q < env.position_min_rad || q > env.position_max_rad {
                return Err(SafetyViolation {
                    channel: i,
                    value: q,
                    reason: ViolationReason::Position {
                        min: env.position_min_rad,
                        max: env.position_max_rad,
                    },
                });
            }
        }
        Ok(())
    }

    /// Reject an implied velocity Δq/Δt above the channel ceiling.
    ///
    /// `dt_us == 0` → physical velocity is UNDEFINED (Δt = 0): the check is
    /// skipped and the firmware executor velocity-bounds advancement
    /// (ADR-3 — dt_us==0 is PROTOCOL SEMANTICS, firmware-authoritative).
    pub fn check_gap_velocity(delta_q: &[f64], dt_us: u32) -> Result<(), SafetyViolation> {
        if dt_us == 0 {
            return Ok(());
        }
        let dt_s = dt_us as f64 / 1_000_000.0;
        for (i, &dq) in delta_q.iter().enumerate() {
            let Some(env) = SAFETY_ENVELOPE.get(i) else {
                continue; // no firmware envelope authority for this channel
            };
            let implied = dq / dt_s;
            if implied.abs() > env.max_velocity_rad_per_s {
                return Err(SafetyViolation {
                    channel: i,
                    value: implied,
                    reason: ViolationReason::Velocity {
                        max: env.max_velocity_rad_per_s,
                    },
                });
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parity: the Rust mirror MUST reproduce the firmware `SAFETY_ENVELOPE`
    /// values exactly (source of truth: `firmware/esp32/src/servo_config.h`).
    #[test]
    fn mirror_matches_firmware_servo_config_values() {
        // base (0): ±1.5708 rad, 1.0 rad/s, URDF/URDF
        assert_eq!(SAFETY_ENVELOPE[0].position_min_rad, -1.5708);
        assert_eq!(SAFETY_ENVELOPE[0].position_max_rad, 1.5708);
        assert_eq!(SAFETY_ENVELOPE[0].max_velocity_rad_per_s, 1.0);
        assert_eq!(SAFETY_ENVELOPE[0].position_source, LimitSource::Urdf);
        assert_eq!(SAFETY_ENVELOPE[0].velocity_source, LimitSource::Urdf);
        // elbow (1): 0..2.0944 rad, 1.0 rad/s, URDF/URDF
        assert_eq!(SAFETY_ENVELOPE[1].position_min_rad, 0.0);
        assert_eq!(SAFETY_ENVELOPE[1].position_max_rad, 2.0944);
        assert_eq!(SAFETY_ENVELOPE[1].max_velocity_rad_per_s, 1.0);
        // wrist (2): ±3.1416 rad TEMPORARY, 2.0 rad/s, Temporary/Temporary
        assert_eq!(SAFETY_ENVELOPE[2].position_min_rad, -3.1416);
        assert_eq!(SAFETY_ENVELOPE[2].position_max_rad, 3.1416);
        assert_eq!(SAFETY_ENVELOPE[2].max_velocity_rad_per_s, 2.0);
        assert_eq!(SAFETY_ENVELOPE[2].position_source, LimitSource::Temporary);
        assert_eq!(SAFETY_ENVELOPE[2].velocity_source, LimitSource::Temporary);
        // prismatic (3): 0..0.06 m, 0.5 rad/s (rad fields hold metres), URDF
        assert_eq!(SAFETY_ENVELOPE[3].position_min_rad, 0.0);
        assert_eq!(SAFETY_ENVELOPE[3].position_max_rad, 0.06);
        assert_eq!(SAFETY_ENVELOPE[3].max_velocity_rad_per_s, 0.5);
        assert_eq!(SAFETY_ENVELOPE[3].position_source, LimitSource::Urdf);

        // The envelope is exactly 4 channels — one per icebot actuated joint.
        assert_eq!(SAFETY_ENVELOPE.len(), 4);
    }

    /// Boundary positions are ACCEPTED (inclusive limits, like the firmware
    /// `<=`/`>=` comparisons) — 1.5708 is exactly at the base ceiling.
    #[test]
    fn check_joints_accepts_at_boundary() {
        // base at +1.5708 (boundary), elbow at 2.0944 (boundary), prismatic at 0.06.
        assert!(SafetyEnvelope::check_joints(&[1.5708, 2.0944, 0.0, 0.06]).is_ok());
    }

    /// A base joint at 4.0 rad (spec scenario test 11: beyond ±1.57) MUST be
    /// rejected with the firmware diagnostic code INVALID_JOINT.
    #[test]
    fn check_joints_rejects_out_of_envelope_base() {
        let err = SafetyEnvelope::check_joints(&[4.0, 0.0, 0.0, 0.01]).unwrap_err();
        assert_eq!(err.channel, 0);
        assert_eq!(err.diagnostic_code(), "INVALID_JOINT");
        assert!(
            matches!(err.reason, ViolationReason::Position { min, max } if min == -1.5708 && max == 1.5708),
            "rejection reason must name the channel envelope: {err}"
        );
    }

    /// The elbow envelope is ASYMMETRIC (0..2.0944): a negative elbow joint is
    /// out-of-envelope even though |−0.1| is small — safety is per-channel.
    #[test]
    fn check_joints_rejects_negative_elbow() {
        let err = SafetyEnvelope::check_joints(&[0.0, -0.1, 0.0, 0.01]).unwrap_err();
        assert_eq!(err.channel, 1);
        assert_eq!(err.diagnostic_code(), "INVALID_JOINT");
    }

    /// Prismatic channel 3: 0..0.06 m — 0.1 m exceeds the 0.06 ceiling.
    #[test]
    fn check_joints_rejects_out_of_envelope_prismatic() {
        let err = SafetyEnvelope::check_joints(&[0.0, 0.0, 0.0, 0.1]).unwrap_err();
        assert_eq!(err.channel, 3);
        assert_eq!(err.diagnostic_code(), "INVALID_JOINT");
    }

    /// Joints beyond the 4-channel envelope (6-DOF robots) have NO firmware
    /// envelope authority — left unchecked (parity with the firmware
    /// validator, which only knows 4 channels).
    #[test]
    fn check_joints_leaves_channels_beyond_four_unchecked() {
        let joints = vec![0.0, 0.0, 0.0, 0.01, 9.9, -9.9]; // 6-DOF
        assert!(SafetyEnvelope::check_joints(&joints).is_ok());
    }

    /// Implied velocity Δq/Δt ≤ channel ceiling: base 1.0 rad over 1.0 s =
    /// 1.0 rad/s, exactly at the 1.0 ceiling → accepted.
    #[test]
    fn check_gap_velocity_accepts_at_ceiling() {
        assert!(SafetyEnvelope::check_gap_velocity(&[1.0, 0.5, 0.0, 0.0], 1_000_000).is_ok());
    }

    /// Base 1.0 rad over 0.5 s = 2.0 rad/s > 1.0 ceiling → rejected with the
    /// VELOCITY_EXCEEDED diagnostic.
    #[test]
    fn check_gap_velocity_rejects_above_ceiling() {
        let err = SafetyEnvelope::check_gap_velocity(&[1.0, 0.5, 0.0, 0.0], 500_000).unwrap_err();
        assert_eq!(err.channel, 0);
        assert_eq!(err.diagnostic_code(), "VELOCITY_EXCEEDED");
    }

    /// dt_us == 0 → physical velocity is UNDEFINED (Δt = 0): the check MUST
    /// NOT reject — the firmware executor velocity-bounds advancement
    /// (ADR-3, dt_us==0 PROTOCOL SEMANTICS — firmware-authoritative).
    #[test]
    fn check_gap_velocity_skips_zero_dt() {
        // A 1.0 rad jump with dt_us == 0 must NOT be read as infinite velocity.
        assert!(SafetyEnvelope::check_gap_velocity(&[1.0, 1.0, 1.0, 1.0], 0).is_ok());
    }
}
