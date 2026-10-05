//! Markdown + YAML frontmatter parsing (the `SKILL.md` convention).

use crate::domain::FrontmatterEntry;

/// A markdown document split into its frontmatter and body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Markdown {
    pub frontmatter: Vec<FrontmatterEntry>,
    /// Markdown body, frontmatter stripped.
    pub body: String,
    pub name: Option<String>,
    pub description: Option<String>,
    /// First `# heading` of the body.
    pub title: Option<String>,
    /// `true` when the document had a frontmatter block at all.
    pub has_frontmatter: bool,
}

impl Markdown {
    /// A one-line summary for lists: frontmatter description, first paragraph or the title.
    pub fn summary(&self) -> Option<String> {
        if let Some(description) = self.description.as_deref().map(str::trim) {
            if !description.is_empty() {
                return Some(truncate(description, 240));
            }
        }
        if let Some(title) = &self.title {
            return Some(truncate(title, 240));
        }
        first_paragraph(&self.body).map(|text| truncate(&text, 240))
    }
}

pub fn parse(text: &str) -> Markdown {
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(text);
    let (yaml, body) = split_frontmatter(normalized);
    let has_frontmatter = yaml.is_some();
    let frontmatter = yaml.map(parse_yaml_entries).unwrap_or_default();

    let lookup = |key: &str| {
        frontmatter
            .iter()
            .find(|entry| entry.key.eq_ignore_ascii_case(key))
            .map(|entry| entry.value.trim().to_string())
            .filter(|value| !value.is_empty())
    };

    let title = body.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("# ")
            .map(|rest| rest.trim().to_string())
            .filter(|rest| !rest.is_empty())
    });

    Markdown {
        name: lookup("name"),
        description: lookup("description").or_else(|| lookup("summary")),
        frontmatter,
        body,
        title,
        has_frontmatter,
    }
}

/// Split `---\n<yaml>\n---\n<body>`.
fn split_frontmatter(text: &str) -> (Option<&str>, String) {
    let mut lines = text.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return (None, String::new());
    };
    if first.trim_end() != "---" {
        return (None, text.to_string());
    }

    let mut offset = first.len();
    let mut yaml_end: Option<(usize, usize)> = None; // (content end, block end)

    for line in lines {
        let trimmed = line.trim_end();
        if trimmed == "---" || trimmed == "..." {
            yaml_end = Some((offset, offset + line.len()));
            break;
        }
        offset += line.len();
    }

    match yaml_end {
        Some((content_end, block_end)) => {
            let yaml = &text[first.len()..content_end];
            let body = text[block_end..]
                .trim_start_matches(['\n', '\r'])
                .to_string();
            (Some(yaml), body)
        }
        // Unterminated frontmatter: treat the whole document as body.
        None => (None, text.to_string()),
    }
}

fn parse_yaml_entries(yaml: &str) -> Vec<FrontmatterEntry> {
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(yaml) else {
        return Vec::new();
    };
    let serde_yaml::Value::Mapping(mapping) = value else {
        return Vec::new();
    };
    mapping
        .into_iter()
        .filter_map(|(key, value)| {
            let key = match key {
                serde_yaml::Value::String(key) => key,
                other => yaml_scalar_to_string(&other)?,
            };
            let value = yaml_scalar_to_string(&value)?;
            Some(FrontmatterEntry { key, value })
        })
        .collect()
}

fn yaml_scalar_to_string(value: &serde_yaml::Value) -> Option<String> {
    Some(match value {
        serde_yaml::Value::Null => String::new(),
        serde_yaml::Value::Bool(flag) => flag.to_string(),
        serde_yaml::Value::Number(number) => number.to_string(),
        serde_yaml::Value::String(text) => text.trim().to_string(),
        serde_yaml::Value::Sequence(items) => items
            .iter()
            .filter_map(yaml_scalar_to_string)
            .collect::<Vec<_>>()
            .join(", "),
        serde_yaml::Value::Mapping(_) | serde_yaml::Value::Tagged(_) => {
            serde_json::to_string(&to_json(value)).ok()?
        }
    })
}

fn to_json(value: &serde_yaml::Value) -> serde_json::Value {
    match value {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(flag) => serde_json::Value::Bool(*flag),
        serde_yaml::Value::Number(number) => number
            .as_i64()
            .map(serde_json::Value::from)
            .or_else(|| number.as_f64().map(serde_json::Value::from))
            .unwrap_or(serde_json::Value::Null),
        serde_yaml::Value::String(text) => serde_json::Value::String(text.clone()),
        serde_yaml::Value::Sequence(items) => {
            serde_json::Value::Array(items.iter().map(to_json).collect())
        }
        serde_yaml::Value::Mapping(mapping) => {
            let mut object = serde_json::Map::new();
            for (key, value) in mapping {
                if let Some(key) = yaml_scalar_to_string(key) {
                    object.insert(key, to_json(value));
                }
            }
            serde_json::Value::Object(object)
        }
        serde_yaml::Value::Tagged(tagged) => to_json(&tagged.value),
    }
}

/// First non-empty paragraph that is not a heading or a list marker.
pub fn first_paragraph(body: &str) -> Option<String> {
    let mut paragraph: Vec<&str> = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#') || trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            if paragraph.is_empty() {
                continue;
            }
            break;
        }
        paragraph.push(trimmed);
    }
    if paragraph.is_empty() {
        None
    } else {
        Some(paragraph.join(" "))
    }
}

fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(limit.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKILL: &str = r#"---
name: pdf-processing
description: Fill and read PDF forms
allowed-tools: Read, Write
tags:
  - pdf
  - forms
---

# PDF processing

Use pdftotext for extraction.
"#;

    #[test]
    fn parses_frontmatter_and_body() {
        let markdown = parse(SKILL);
        assert!(markdown.has_frontmatter);
        assert_eq!(markdown.name.as_deref(), Some("pdf-processing"));
        assert_eq!(
            markdown.description.as_deref(),
            Some("Fill and read PDF forms")
        );
        assert_eq!(markdown.title.as_deref(), Some("PDF processing"));
        assert!(markdown.body.starts_with("# PDF processing"));
        assert!(!markdown.body.contains("allowed-tools"));
        assert_eq!(
            markdown
                .frontmatter
                .iter()
                .find(|entry| entry.key == "tags")
                .unwrap()
                .value,
            "pdf, forms"
        );
        // order is preserved
        assert_eq!(markdown.frontmatter[0].key, "name");
        assert_eq!(markdown.frontmatter[3].key, "tags");
    }

    #[test]
    fn handles_documents_without_frontmatter() {
        let markdown = parse("# Title\n\nSome text.\n");
        assert!(!markdown.has_frontmatter);
        assert!(markdown.frontmatter.is_empty());
        assert_eq!(markdown.summary().as_deref(), Some("Title"));
        assert_eq!(markdown.title.as_deref(), Some("Title"));
    }

    #[test]
    fn unterminated_frontmatter_is_treated_as_body() {
        let markdown = parse("---\nname: broken\n");
        assert!(!markdown.has_frontmatter);
        assert!(markdown.body.contains("name: broken"));
    }

    #[test]
    fn handles_crlf_and_bom() {
        let markdown = parse("\u{feff}---\r\nname: win\r\n---\r\n# Body\r\n");
        assert_eq!(markdown.name.as_deref(), Some("win"));
        assert!(markdown.body.starts_with("# Body"));
    }

    #[test]
    fn first_paragraph_skips_headings_and_lists() {
        let paragraph =
            first_paragraph("# Heading\n\n- bullet\n\nActual text here.\nSecond line.\n\nmore");
        assert_eq!(paragraph.as_deref(), Some("Actual text here. Second line."));
        assert!(first_paragraph("# only a heading").is_none());
    }

    #[test]
    fn summary_prefers_description_then_title() {
        let markdown = parse("---\nname: x\n---\n\n# Heading\n\nBody text.\n");
        assert_eq!(markdown.summary().as_deref(), Some("Heading"));
        let long = parse(&format!("---\ndescription: {}\n---\n", "x".repeat(500)));
        assert_eq!(long.summary().unwrap().chars().count(), 240);
    }
}
