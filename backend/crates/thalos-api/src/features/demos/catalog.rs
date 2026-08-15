//! Demo catalog — `demos/index.json` loader + lookup (design D9/D10).
//! Catalog is the AUTHORITY (D10): `catalog.lookup(id)` → entry → known
//! filename → read. NEVER `filesystem/{id}/scene.json`; client sends `demo_id`
//! only (never a path).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Default demos root (repo-relative) when `THALOS_DEMOS_ROOT` is unset (D9).
pub const DEFAULT_DEMOS_ROOT: &str = "./demos";
/// Catalog file name at the demos root (D10).
pub const CATALOG_FILE: &str = "index.json";

/// One catalog entry — composition metadata + artifact paths (demo-composition
/// spec). `scene`/`program` resolve relative to the demos root; NOT serialized
/// in the listing response (`GET /demos` → `{id, title, category, narrative?}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DemoCatalogEntry {
    pub id: String,
    pub title: String,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narrative: Option<String>,
    #[serde(skip_serializing)]
    pub scene: String,
    #[serde(skip_serializing)]
    pub program: String,
}

/// Catalog load failures (server-side artifact problems).
#[derive(Debug)]
pub enum CatalogError {
    /// `index.json` exists but cannot be read.
    Io(std::io::Error),
    /// `index.json` exists but is not a valid catalog array.
    Malformed(String),
}

/// The loaded demo catalog.
#[derive(Debug, Clone)]
pub struct DemoCatalog {
    root: PathBuf,
    entries: Vec<DemoCatalogEntry>,
}

/// Pure demos-root decision (D9): env value if present, else `./demos`.
/// Kept pure so the env policy is unit-testable without process mutation.
pub fn resolve_demos_root(env_value: Option<&str>) -> PathBuf {
    env_value
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_DEMOS_ROOT))
}

/// Read `THALOS_DEMOS_ROOT` (D9), defaulting to `./demos`.
pub fn demos_root() -> PathBuf {
    resolve_demos_root(std::env::var("THALOS_DEMOS_ROOT").ok().as_deref())
}

impl DemoCatalog {
    /// Load the catalog from the env-resolved demos root (D9).
    pub fn load() -> Result<Self, CatalogError> {
        Self::load_from(demos_root())
    }

    /// Load from an explicit root. A missing `index.json` yields an EMPTY
    /// catalog (design: `GET /demos` → `[]` when no demos are registered).
    pub fn load_from(root: impl AsRef<Path>) -> Result<Self, CatalogError> {
        let root = root.as_ref().to_path_buf();
        let catalog_path = root.join(CATALOG_FILE);
        let raw = match fs::read_to_string(&catalog_path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self {
                    root,
                    entries: Vec::new(),
                });
            }
            Err(e) => return Err(CatalogError::Io(e)),
        };
        let entries: Vec<DemoCatalogEntry> =
            serde_json::from_str(&raw).map_err(|e| CatalogError::Malformed(e.to_string()))?;
        Ok(Self { root, entries })
    }

    pub fn entries(&self) -> &[DemoCatalogEntry] {
        &self.entries
    }

    /// Look up a demo by stable id (D10: catalog is the authority).
    pub fn lookup(&self, id: &str) -> Option<&DemoCatalogEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Absolute path of the entry's scene file (never derived from `{id}`).
    pub fn scene_path(&self, entry: &DemoCatalogEntry) -> PathBuf {
        self.root.join(&entry.scene)
    }

    /// Absolute path of the entry's program file (never derived from `{id}`).
    pub fn program_path(&self, entry: &DemoCatalogEntry) -> PathBuf {
        self.root.join(&entry.program)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fixture(dir: &Path, name: &str, content: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(name), content).unwrap();
    }

    fn tmp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("thalos-demos-catalog-{name}-{}", std::process::id()))
    }

    #[test]
    fn missing_index_json_yields_empty_catalog() {
        let catalog = DemoCatalog::load_from(tmp_root("missing")).unwrap();
        assert!(catalog.entries().is_empty(), "no index.json → no demos");
    }

    #[test]
    fn lookup_finds_entry_by_id_and_paths_resolve_from_root() {
        let root = tmp_root("lookup");
        write_fixture(
            &root,
            "index.json",
            r#"[{"id":"happy-path","title":"Happy","category":"basics","scene":"happy-path/scene.json","program":"happy-path/program.thalos"}]"#,
        );
        let catalog = DemoCatalog::load_from(&root).unwrap();
        let entry = catalog.lookup("happy-path").expect("entry found");
        assert_eq!(entry.title, "Happy");
        assert_eq!(catalog.scene_path(entry), root.join("happy-path/scene.json"));
        assert_eq!(catalog.program_path(entry), root.join("happy-path/program.thalos"));
    }

    #[test]
    fn lookup_unknown_id_returns_none() {
        let root = tmp_root("unknown");
        write_fixture(&root, "index.json", r#"[]"#);
        let catalog = DemoCatalog::load_from(&root).unwrap();
        assert!(catalog.lookup("ghost").is_none());
    }

    #[test]
    fn malformed_index_json_is_an_error() {
        let root = tmp_root("malformed");
        write_fixture(&root, "index.json", r#"not-json"#);
        assert!(matches!(DemoCatalog::load_from(&root), Err(CatalogError::Malformed(_))));
    }

    #[test]
    fn default_root_falls_back_to_repo_relative_demos() {
        assert_eq!(resolve_demos_root(None), PathBuf::from("./demos"));
        assert_eq!(
            resolve_demos_root(Some("demos")),
            PathBuf::from("demos"),
            "a set THALOS_DEMOS_ROOT wins over the default"
        );
    }
}
