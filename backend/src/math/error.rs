use thiserror::Error;

#[derive(Error, Debug)]
pub enum MathError {
    #[error("Cannot normalize a zero vector")]
    ZeroVectorNormalization,
}