//! Tag metadata, shared by everything that shows tags or filters by them.
//!
//! A tag comes from somewhere else's file — what a Hub source declares for its entries, what a
//! `SKILL.md` says about itself — and every one of them goes through [`normalize_tags`], so one
//! tag is one string (and one colour: the frontend hashes the name) wherever it appears.

/// Longest tag list one entry carries, and the longest single tag.
///
/// Tags are browsing metadata shown on a card and offered as filters, so a third party — a source
/// file or somebody else's `SKILL.md` — cannot make one entry wear a paragraph.
pub const MAX_TAGS: usize = 12;
pub const MAX_TAG_LEN: usize = 40;

/// Tags as Ahabby keeps them: trimmed, non-empty, unique (case-insensitively) and bounded.
///
/// The first spelling of a tag wins, so a publisher's own casing survives while `Design` and
/// `design` never both appear — every comparison made against them is case-insensitive anyway.
pub fn normalize_tags(tags: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() || tag.chars().count() > MAX_TAG_LEN {
            continue;
        }
        if tag.chars().any(char::is_control) {
            continue;
        }
        if kept
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(tag))
        {
            continue;
        }
        kept.push(tag.to_string());
        if kept.len() == MAX_TAGS {
            break;
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_trimmed_deduplicated_and_bounded() {
        let tags = normalize_tags([
            " design ".to_string(),
            "DESIGN".to_string(),
            String::new(),
            "   ".to_string(),
            "testing".to_string(),
            "x".repeat(MAX_TAG_LEN + 1),
            "with\u{7}control".to_string(),
        ]);
        assert_eq!(tags, ["design", "testing"]);

        let many: Vec<String> = (0..MAX_TAGS + 5)
            .map(|index| format!("tag{index}"))
            .collect();
        assert_eq!(normalize_tags(many).len(), MAX_TAGS);
    }
}
