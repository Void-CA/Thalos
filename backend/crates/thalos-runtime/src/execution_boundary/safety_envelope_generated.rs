// DO NOT EDIT — generated from config/safety-envelope.toml
// Regenerate: python3 tools/generate_safety_config.py

// metadata: schema_version 1, robot icebot, dof_count 4

pub const SAFETY_ENVELOPE: [ChannelEnvelope; 4] = [
    // base (0)
    ChannelEnvelope {
        position_min_rad: -1.5708, position_max_rad: 1.5708,
        pulse_min_us: 350, pulse_max_us: 1650,
        max_velocity_rad_per_s: 1.0,
        position_source: LimitSource::Urdf,
        pulse_source: LimitSource::Configured,
        velocity_source: LimitSource::Urdf,
    },
    // elbow (1)
    ChannelEnvelope {
        position_min_rad: 0.0, position_max_rad: 2.0944,
        pulse_min_us: 350, pulse_max_us: 2050,
        max_velocity_rad_per_s: 1.0,
        position_source: LimitSource::Urdf,
        pulse_source: LimitSource::Configured,
        velocity_source: LimitSource::Urdf,
    },
    // wrist (2)
    ChannelEnvelope {
        position_min_rad: -3.1416, position_max_rad: 3.1416,
        pulse_min_us: 300, pulse_max_us: 2600,
        max_velocity_rad_per_s: 2.0,
        position_source: LimitSource::Temporary,
        pulse_source: LimitSource::Temporary,
        velocity_source: LimitSource::Temporary,
    },
    // prismatic (3)
    ChannelEnvelope {
        position_min_rad: 0.0, position_max_rad: 0.06,
        pulse_min_us: 500, pulse_max_us: 2500,
        max_velocity_rad_per_s: 0.5,
        position_source: LimitSource::Urdf,
        pulse_source: LimitSource::Configured,
        velocity_source: LimitSource::Urdf,
    },
];
