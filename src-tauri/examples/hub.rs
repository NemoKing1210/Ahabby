//! Diagnostic tool: read the Hub's sources over the network and print what they answer.
//!
//! ```bash
//! cargo run --manifest-path src-tauri/Cargo.toml --example hub
//! cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --query pdf --limit 3
//! cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --tag design --tag frontend
//! cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --payload
//! ```
//!
//! Maintainers use it to check a source against the real API without launching the desktop app:
//! every source is searched for one page, its first entry of each kind is opened, and (with
//! `--payload`) the files of the first skill entry are fetched exactly as an install would fetch
//! them — without writing anything anywhere. `--tag` narrows the search the way the Hub screen's
//! tag filter does, which is how a source's rules are checked against the real collection.

use std::path::PathBuf;

use ahabby_lib::domain::{HubQuery, HubResourceKind, Proxy};
use ahabby_lib::services::HubService;

fn user_dir() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ahabby")
        .join("hub")
}

#[tokio::main]
async fn main() {
    let mut query = String::new();
    let mut limit = 5u32;
    let mut payload = false;
    let mut tags: Vec<String> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--query" => query = args.next().unwrap_or_default(),
            "--tag" => {
                if let Some(tag) = args.next() {
                    tags.push(tag);
                }
            }
            "--limit" => {
                limit = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(limit)
            }
            "--payload" => payload = true,
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
    }

    let dir = user_dir();
    let service = HubService::new(&Proxy::none());
    let catalog = service.sources(&dir);

    println!("sources: {}", catalog.sources.len());
    for problem in &catalog.problems {
        println!("  problem: {} — {}", problem.source, problem.message);
    }
    println!("your own sources go in: {}", catalog.user_dir);
    println!();

    for source in &catalog.sources {
        println!(
            "== {} ({:?}, {}) builtin={}",
            source.name,
            source.kind,
            source
                .provides
                .iter()
                .map(|kind| kind.label())
                .collect::<Vec<_>>()
                .join("+"),
            source.builtin
        );
        let vocabulary = source.tag_vocabulary();
        println!(
            "   tags declared: {}{}",
            if vocabulary.is_empty() {
                "(none)".to_string()
            } else {
                vocabulary.join(", ")
            },
            if source.tag_rules.is_empty() {
                String::new()
            } else {
                format!(" ({} rules)", source.tag_rules.len())
            }
        );
        let request = HubQuery {
            query: query.clone(),
            limit: Some(limit),
            refresh: true,
            tags: tags.clone(),
            ..HubQuery::default()
        };
        match service.search(&catalog, &source.id, &request).await {
            Ok(page) => {
                println!(
                    "   {} entries in {} ms (of {}{}){}",
                    page.entries.len(),
                    page.report.duration_ms,
                    page.report
                        .total
                        .map(|total| total.to_string())
                        .unwrap_or_else(|| "?".to_string()),
                    if page.report.next_cursor.is_some() {
                        ", more available"
                    } else {
                        ""
                    },
                    if page.report.from_cache {
                        ", cached"
                    } else {
                        ""
                    }
                );
                for problem in &page.report.problems {
                    println!("   note: {problem}");
                }
                for entry in page.entries.iter().take(limit as usize) {
                    println!(
                        "   - [{}] {} — {}{}{}{}",
                        entry.kind.label(),
                        entry.name,
                        entry.description.as_deref().unwrap_or("(no description)"),
                        entry
                            .version
                            .as_deref()
                            .map(|version| format!(" v{version}"))
                            .unwrap_or_default(),
                        if entry.tags.is_empty() {
                            String::new()
                        } else {
                            format!(" [{}]", entry.tags.join(", "))
                        },
                        if entry.installable {
                            String::new()
                        } else {
                            format!(
                                " [not installable: {}]",
                                entry.install_problem.as_deref().unwrap_or("unknown")
                            )
                        }
                    );
                }
                if payload {
                    report_payload(&service, &catalog, page.entries.iter()).await;
                }
            }
            Err(error) => println!("   failed: {error}"),
        }
        println!();
    }
}

/// Open the first skill and the first server of a page, and fetch the skill's files.
async fn report_payload<'a>(
    service: &HubService,
    catalog: &ahabby_lib::domain::HubSourceCatalog,
    entries: impl Iterator<Item = &'a ahabby_lib::domain::HubEntry>,
) {
    let entries: Vec<&ahabby_lib::domain::HubEntry> = entries.collect();
    let skill = entries
        .iter()
        .find(|entry| entry.kind == HubResourceKind::Skill);
    let server = entries
        .iter()
        .find(|entry| entry.kind == HubResourceKind::Mcp);

    if let Some(entry) = skill {
        match service.detail(catalog, &entry.id, false).await {
            Ok(detail) => {
                println!(
                    "   detail: {} → {} files, {} bytes, scripts={}",
                    detail.entry.id,
                    detail.files.len(),
                    detail.entry.size_bytes.unwrap_or_default(),
                    detail.entry.has_scripts
                );
                for file in detail.files.iter().take(5) {
                    println!(
                        "     {:>8} bytes  {:?}  {}",
                        file.size_bytes, file.kind, file.path
                    );
                }
                match service
                    .skill_install(catalog, &entry.id, entry.name.clone())
                    .await
                {
                    Ok(install) => {
                        let bytes: usize = install.files.iter().map(|file| file.bytes.len()).sum();
                        println!(
                            "   payload: '{}' → {} files, {bytes} bytes ready to write",
                            install.name,
                            install.files.len()
                        );
                    }
                    Err(error) => println!("   payload failed: {error}"),
                }
            }
            Err(error) => println!("   detail failed: {error}"),
        }
    }

    if let Some(entry) = server {
        match service.detail(catalog, &entry.id, false).await {
            Ok(detail) => {
                println!(
                    "   detail: {} → transport {:?}, {} inputs",
                    detail.entry.id,
                    detail.transport,
                    detail.inputs.len()
                );
                for input in detail.inputs.iter().take(5) {
                    println!(
                        "     {}{}{} — {}",
                        input.key,
                        if input.required { " (required)" } else { "" },
                        if input.secret { " (secret)" } else { "" },
                        input.description.as_deref().unwrap_or("")
                    );
                }
            }
            Err(error) => println!("   detail failed: {error}"),
        }
    }
}
