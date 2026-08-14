//! SceneFile validation — tiers (a) schema + (b) semantic + (c) robot compat.
//! Tier (a) is enforced by serde on parse; tier (b) is pure semantic checks
//! (duplicate IDs, negative dimensions, non-finite poses, unknown references);
//! tier (c) compares the SceneFile robot against the loaded runtime robot.
//!
//! Tier (d) — planning validity — is deliberately NOT a SceneFile concern; it is
//! non-blocking and handled by `POST /plan/analyze`.
