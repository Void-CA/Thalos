//! Re-exports from `thalos_math` for backward compatibility.
//!
//! All core geometry types (Vector3, Quaternion, Transform3D, etc.)
//! now live in the `thalos_math` crate. This module re-exports them
//! through the legacy paths so the rest of the codebase doesn't break
//! during migration.
//!
//! Planning-specific algebra (DynamicMatrix, DynamicVector) stays here
//! since it depends on both nalgebra and the old crate structure.

pub mod algebra;

pub mod geometry {
    pub mod vectors {
        pub use thalos_math::{Vector3, UnitVector3};
    }
    pub mod rotations {
        pub use thalos_math::{Quaternion, UnitQuaternion};
    }
    pub mod rigid {
        pub use thalos_math::Transform3D;
    }
}

pub use thalos_math::constants;
pub use thalos_math::error;

pub mod traits {
    pub mod products {
        pub use thalos_math::{Cross, Dot};
    }
}
