//! JSONC support: JSON with comments and trailing commas.
//!
//! Several agents ship `jsonc` (Cursor's `mcp.json`, opencode's `opencode.jsonc`) and users
//! comment out servers they are not using. Ahabby must be able to:
//!
//! * **read** such a file and still understand its structure,
//! * **validate** it before a save,
//! * **remove one entry** without reprinting the whole file — comments and formatting must
//!   survive, because rewriting a commented-out entry away would silently destroy the user's
//!   notes. Removal is therefore done by splicing the exact byte range of the member out of
//!   the original text, which is what [`remove_member`] does.

/// Byte length of a leading UTF-8 BOM, if any.
fn bom_len(text: &str) -> usize {
    if text.as_bytes().starts_with(&[0xEF, 0xBB, 0xBF]) {
        3
    } else {
        0
    }
}

/// Strip comments and trailing commas so that a strict JSON parser accepts the document.
pub fn strip(text: &str) -> String {
    let text = &text[bom_len(text)..];
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'"' => {
                let end = end_of_string(bytes, index);
                out.push_str(&text[index..end]);
                index = end;
            }
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
                index = (index + 2).min(bytes.len());
            }
            b',' => {
                // Drop the comma when the next significant byte closes the container.
                let mut lookahead = index + 1;
                loop {
                    match bytes.get(lookahead) {
                        Some(b' ' | b'\t' | b'\r' | b'\n') => lookahead += 1,
                        Some(b'/') if bytes.get(lookahead + 1) == Some(&b'/') => {
                            while lookahead < bytes.len() && bytes[lookahead] != b'\n' {
                                lookahead += 1;
                            }
                        }
                        Some(b'/') if bytes.get(lookahead + 1) == Some(&b'*') => {
                            lookahead += 2;
                            while lookahead + 1 < bytes.len()
                                && !(bytes[lookahead] == b'*' && bytes[lookahead + 1] == b'/')
                            {
                                lookahead += 1;
                            }
                            lookahead = (lookahead + 2).min(bytes.len());
                        }
                        Some(b'}' | b']') => break,
                        _ => {
                            out.push(',');
                            break;
                        }
                    }
                }
                index += 1;
            }
            _ => {
                let ch = text[index..].chars().next().unwrap_or(' ');
                out.push(ch);
                index += ch.len_utf8();
            }
        }
    }
    out
}

/// Validate a JSONC document.
pub fn validate(text: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&strip(text))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Remove the member at `key_path`, preserving every other byte of the document.
///
/// Returns `Ok(None)` when the document has no such member.
pub fn remove_member(text: &str, key_path: &[String]) -> Result<Option<String>, String> {
    if key_path.is_empty() {
        return Err("an empty key path cannot be removed".to_string());
    }
    // The BOM stays in the document (offsets refer to the original text) but the walker
    // starts after it.
    let mut scanner = Scanner {
        text,
        pos: bom_len(text),
    };
    match scanner.member_span(key_path) {
        Some(span) => Ok(Some(splice_out(text, span))),
        // Not found — or a document this walker cannot follow. Either way there is nothing
        // to remove; validation of the file itself happens elsewhere and reports the real
        // problem with a proper message.
        None => Ok(None),
    }
}

/// Byte range of a member (its key and value) inside the document.
struct Scanner<'a> {
    text: &'a str,
    pos: usize,
}

impl<'a> Scanner<'a> {
    /// The `'a` lifetime is deliberate: the byte slice outlives the `&self` borrow, so the
    /// scanner can advance its own position while still reading the document.
    fn bytes(&self) -> &'a [u8] {
        self.text.as_bytes()
    }

    fn skip_trivia(&mut self) {
        let bytes = self.bytes();
        loop {
            match bytes.get(self.pos) {
                Some(b' ' | b'\t' | b'\r' | b'\n') => self.pos += 1,
                Some(b'/') if bytes.get(self.pos + 1) == Some(&b'/') => {
                    while self.pos < bytes.len() && bytes[self.pos] != b'\n' {
                        self.pos += 1;
                    }
                }
                Some(b'/') if bytes.get(self.pos + 1) == Some(&b'*') => {
                    self.pos += 2;
                    while self.pos + 1 < bytes.len()
                        && !(bytes[self.pos] == b'*' && bytes[self.pos + 1] == b'/')
                    {
                        self.pos += 1;
                    }
                    self.pos = (self.pos + 2).min(bytes.len());
                }
                _ => return,
            }
        }
    }

    /// Reads a string literal and returns its decoded contents.
    fn read_string(&mut self) -> Option<String> {
        if self.bytes().get(self.pos) != Some(&b'"') {
            return None;
        }
        let start = self.pos;
        let end = end_of_string(self.bytes(), start);
        if end > self.text.len() {
            return None;
        }
        self.pos = end;
        serde_json::from_str::<String>(&self.text[start..end]).ok()
    }

    /// Advances past one value, returning its end offset.
    fn skip_value(&mut self) -> Option<usize> {
        self.skip_trivia();
        match self.bytes().get(self.pos)? {
            b'"' => {
                self.pos = end_of_string(self.bytes(), self.pos);
                Some(self.pos)
            }
            b'{' | b'[' => {
                let mut depth = 0usize;
                loop {
                    match self.bytes().get(self.pos)? {
                        b'"' => self.pos = end_of_string(self.bytes(), self.pos),
                        b'{' | b'[' => {
                            depth += 1;
                            self.pos += 1;
                        }
                        b'}' | b']' => {
                            depth -= 1;
                            self.pos += 1;
                            if depth == 0 {
                                return Some(self.pos);
                            }
                        }
                        _ => self.pos += 1,
                    }
                }
            }
            _ => {
                let start = self.pos;
                while let Some(byte) = self.bytes().get(self.pos) {
                    if matches!(byte, b',' | b'}' | b']') || byte.is_ascii_whitespace() {
                        break;
                    }
                    self.pos += 1;
                }
                if self.pos == start {
                    None
                } else {
                    Some(self.pos)
                }
            }
        }
    }

    /// Finds the byte range of the member addressed by `key_path`.
    fn member_span(&mut self, key_path: &[String]) -> Option<(usize, usize)> {
        self.skip_trivia();
        if self.bytes().get(self.pos) != Some(&b'{') {
            return None;
        }
        self.pos += 1;

        loop {
            self.skip_trivia();
            match self.bytes().get(self.pos)? {
                b'}' => return None,
                b',' => {
                    self.pos += 1;
                    continue;
                }
                _ => {}
            }

            let key_start = self.pos;
            let key = self.read_string()?;
            self.skip_trivia();
            if self.bytes().get(self.pos)? != &b':' {
                return None;
            }
            self.pos += 1;

            self.skip_trivia();
            let value_start = self.pos;
            let value_end = self.skip_value()?;

            if key == key_path[0] {
                if key_path.len() == 1 {
                    return Some((key_start, value_end));
                }
                let mut nested = Scanner {
                    text: self.text,
                    pos: value_start,
                };
                if let Some(span) = nested.member_span(&key_path[1..]) {
                    return Some(span);
                }
            }
            let _ = value_end;
        }
    }
}

/// End offset (exclusive) of the string literal starting at `start`.
fn end_of_string(bytes: &[u8], start: usize) -> usize {
    let mut index = start + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'"' => return index + 1,
            _ => index += 1,
        }
    }
    bytes.len()
}

/// Remove `[start, end)` plus one adjacent comma so the document stays valid.
fn splice_out(text: &str, (start, end): (usize, usize)) -> String {
    let bytes = text.as_bytes();
    let mut after = end;
    while after < bytes.len() && bytes[after].is_ascii_whitespace() {
        after += 1;
    }
    if bytes.get(after) == Some(&b',') {
        let mut out = String::with_capacity(text.len());
        out.push_str(&text[..start]);
        // Keep the whitespace that followed the comma so indentation survives.
        let mut next = after + 1;
        while next < bytes.len() && matches!(bytes[next], b' ' | b'\t') {
            next += 1;
        }
        out.push_str(&text[next..]);
        return out;
    }

    // Last member: drop the comma that precedes it instead.
    let mut before = start;
    while before > 0 && bytes[before - 1].is_ascii_whitespace() {
        before -= 1;
    }
    if before > 0 && bytes[before - 1] == b',' {
        let mut out = String::with_capacity(text.len());
        out.push_str(&text[..before - 1]);
        out.push_str(&text[end..]);
        return out;
    }

    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..start]);
    out.push_str(&text[end..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURSOR_LIKE: &str = r#"{
  "mcpServers": {
    "Context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": {}
    },
    "Figma": {
      "url": "https://mcp.figma.com/mcp",
      "headers": {}
    }
    // "chrome-devtools": {
    //   "command": "npx -y chrome-devtools-mcp@latest"
    // }
  },
  "note": "keep me"
}
"#;

    fn path(segments: &[&str]) -> Vec<String> {
        segments
            .iter()
            .map(|segment| (*segment).to_string())
            .collect()
    }

    #[test]
    fn strips_comments_and_trailing_commas() {
        let stripped = strip(CURSOR_LIKE);
        assert!(!stripped.contains("chrome-devtools"));
        assert!(stripped.contains("keep me"));
        let value: serde_json::Value = serde_json::from_str(&stripped).unwrap();
        assert_eq!(
            value["mcpServers"]["Figma"]["url"],
            "https://mcp.figma.com/mcp"
        );
        assert_eq!(value["note"], "keep me");

        // Trailing comma before a closing brace disappears (the comment line leaves behind
        // only whitespace, which does not matter: the stripped text is only ever parsed).
        let with_trailing = "{\n  \"a\": 1,\n  // comment\n}\n";
        let stripped_trailing = strip(with_trailing);
        assert!(!stripped_trailing.contains("comment"));
        let parsed: serde_json::Value = serde_json::from_str(&stripped_trailing).unwrap();
        assert_eq!(parsed["a"], 1);
        validate(with_trailing).unwrap();

        // Commas inside strings survive.
        let stringy = "{\"a\": \"x, // y\", \"b\": 1}";
        assert!(strip(stringy).contains("x, // y"));
        validate(stringy).unwrap();
    }

    #[test]
    fn accepts_a_utf8_bom() {
        let document = "\u{feff}{ \"mcpServers\": { \"x\": { \"url\": \"https://x\" } } }";
        validate(document).unwrap();
        let updated = remove_member(document, &path(&["mcpServers", "x"]))
            .unwrap()
            .unwrap();
        assert!(updated.starts_with('\u{feff}'), "the BOM survives the edit");
        assert!(!updated.contains("\"x\""));
        validate(&updated).unwrap();
    }

    #[test]
    fn validates_real_world_jsonc() {
        validate(CURSOR_LIKE).unwrap();
        assert!(validate("{ \"a\": 1, }").is_ok());
        assert!(validate("{ \"a\": }").is_err());
        assert!(validate("{ nope }").is_err());
    }

    #[test]
    fn removes_a_member_and_keeps_every_comment() {
        let updated = remove_member(CURSOR_LIKE, &path(&["mcpServers", "Figma"]))
            .unwrap()
            .expect("member exists");

        assert!(!updated.contains("Figma"));
        assert!(updated.contains("Context7"));
        assert!(updated.contains("// \"chrome-devtools\": {"));
        assert!(updated.contains("\"note\": \"keep me\""));
        validate(&updated).unwrap();

        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["mcpServers"].get("Figma").is_none());
        assert!(value["mcpServers"]["Context7"].is_object());
    }

    #[test]
    fn removes_the_first_and_the_only_member() {
        let document = r#"{ "a": 1, "b": 2 }"#;
        assert_eq!(
            remove_member(document, &path(&["a"])).unwrap().unwrap(),
            r#"{ "b": 2 }"#
        );
        assert_eq!(
            remove_member(document, &path(&["b"])).unwrap().unwrap(),
            r#"{ "a": 1 }"#
        );

        let single = "{\n  \"only\": {\n    \"x\": 1\n  }\n}\n";
        let updated = remove_member(single, &path(&["only"])).unwrap().unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value.as_object().unwrap().is_empty());
        validate(&updated).unwrap();
    }

    #[test]
    fn removes_nested_members_deep_in_the_document() {
        let updated = remove_member(CURSOR_LIKE, &path(&["mcpServers", "Context7"]))
            .unwrap()
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["mcpServers"].get("Context7").is_none());
        assert!(value["mcpServers"]["Figma"].is_object());
    }

    #[test]
    fn missing_members_are_not_an_error() {
        assert!(remove_member(CURSOR_LIKE, &path(&["nope"]))
            .unwrap()
            .is_none());
        assert!(remove_member(CURSOR_LIKE, &path(&["mcpServers", "nope"]))
            .unwrap()
            .is_none());
        assert!(remove_member(CURSOR_LIKE, &[]).is_err());
    }

    #[test]
    fn braces_inside_strings_do_not_confuse_the_scanner() {
        let document = r#"{
  "a": "} not a real brace {",
  "b": { "c": 1 },
  "d": 2
}
"#;
        let updated = remove_member(document, &path(&["b"])).unwrap().unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert_eq!(value["a"], "} not a real brace {");
        assert!(value.get("b").is_none());
        assert_eq!(value["d"], 2);
    }
}
