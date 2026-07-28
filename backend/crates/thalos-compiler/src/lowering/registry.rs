//! Backend registry — placeholder for future dynamic backend selection.
//!
//! In a future iteration this module will hold a registry mapping
//! `&'static str` (backend name) to `Box<dyn LoweringBackend>` for
//! dynamic dispatch. For v1, backends are selected statically.
