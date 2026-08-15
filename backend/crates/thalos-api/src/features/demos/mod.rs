//! Demos feature (design D9/D10/D12): catalog listing + scene/program fetch.
//! GET-only endpoints — NO POST/PUT/PATCH (D12). The catalog is the authority
//! (D10); `THALOS_DEMOS_ROOT` env var locates the demos root (D9).

pub mod catalog;
pub mod handler;
