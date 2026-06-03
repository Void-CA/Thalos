use crate::app::error::ApiError;

use thalos_runtime::RuntimeError;

impl From<RuntimeError> for ApiError {
    fn from(e: RuntimeError) -> Self {
        match e {
            RuntimeError::RobotModel(e) => e.into(),
        }
    }
}
