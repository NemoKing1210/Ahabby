//! Declarative catalog of agents. See [`loader`] for how builtin and user manifests merge.
pub mod loader;

pub use loader::{builtin_count, builtin_ids, is_builtin_id, load, parse_manifest, Catalog};
