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

/// Move the member at `from` to `to`, preserving every byte of the document that is not the
/// moved member.
///
/// `from` and `to` are key paths that end with the member's own name
/// (`["mcpServers", "github"]` → `["mcpServersDisabled", "github"]`); the container (all but the
/// last segment) is created when it is missing, including missing intermediate objects.
///
/// Plain JSON is a JSONC document without comments, so this serves both formats.
///
/// * `Ok(None)` — there is no member at `from`.
/// * `Err(..)` — the document cannot be walked, or a member already exists at `to`.
pub fn move_member(text: &str, from: &[String], to: &[String]) -> Result<Option<String>, String> {
    if from.is_empty() || to.is_empty() {
        return Err("a move needs a source and a destination key path".to_string());
    }

    let mut source = Scanner {
        text,
        pos: bom_len(text),
    };
    let Some((start, end)) = source.member_span(from) else {
        return Ok(None);
    };
    let member = &text[start..end];

    let mut destination = Scanner {
        text,
        pos: bom_len(text),
    };
    if destination.member_value_span(to).is_some() {
        let at = to.join(".");
        return Err(format!("a member already exists at {at}"));
    }

    // Take the member out first and place it in the shortened document: the two edits then
    // never have to agree on byte positions.
    let without = splice_out(text, (start, end));
    insert_member(&without, to, member)
}

/// `true` when the document already holds a member at `key_path`.
///
/// [`move_member`] reports the same condition as a plain error string, which its caller has to
/// report as a malformed document; asking first lets a caller answer with the honest error
/// instead.
pub fn has_member(text: &str, key_path: &[String]) -> bool {
    if key_path.is_empty() {
        return false;
    }
    let mut scanner = Scanner {
        text,
        pos: bom_len(text),
    };
    scanner.member_value_span(key_path).is_some()
}

/// Insert a new member at `key_path` with `value`, preserving every other byte of the
/// document and laying the value out like the object around it.
///
/// * `Err` — a member already exists at `key_path` (ask with [`has_member`] first to report
///   that as its own error), or the document cannot be walked.
/// * `Ok(Some(text))` — the updated document.
///
/// Plain JSON is a JSONC document without comments, so both formats share this path.
pub fn insert_new_member(
    text: &str,
    key_path: &[String],
    value: &serde_json::Value,
) -> Result<Option<String>, String> {
    if key_path.is_empty() {
        return Err("an empty key path cannot hold a member".to_string());
    }
    if has_member(text, key_path) {
        return Err(format!("a member already exists at {}", key_path.join(".")));
    }
    let (name, container) = key_path.split_last().expect("checked non-empty");
    let key = serde_json::to_string(name).map_err(|error| error.to_string())?;
    let pretty = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;

    let Some((depth, (open, close))) = deepest_object(text, container) else {
        return Err("the document has no object that can hold the member".to_string());
    };
    if !text[open..close].contains('\n') {
        return insert_member(text, key_path, &format!("{key}: {}", one_line(&pretty)));
    }

    // The member's own lines sit one level deeper than the containers that hold it, which is
    // exactly the indentation `insert_member` gives to the member's first line.
    let child_indent = format!("{}  ", line_indent(text, close));
    let key_indent = format!("{child_indent}{}", "  ".repeat(container.len() - depth));
    let member = format!("{key}: {}", indent_after_first_line(&pretty, &key_indent));
    insert_member(text, key_path, &member)
}

/// Replace the value of the member at `key_path` with the verbatim `replacement` token,
/// preserving every other byte of the document — comments, key order and trailing commas
/// included, because only the value's own byte range is spliced out.
///
/// The caller owns the token's *shape* (a string, a number, a boolean), so this function never
/// has to know a value's type; it only has to find where the old one starts and ends.
///
/// * `Ok(None)` — there is no member at `key_path`.
/// * `Err` — the document cannot be walked, or the splice would break it.
pub fn replace_member_value(
    text: &str,
    key_path: &[String],
    replacement: &str,
) -> Result<Option<String>, String> {
    if key_path.is_empty() {
        return Err("an empty key path cannot be replaced".to_string());
    }
    let mut scanner = Scanner {
        text,
        pos: bom_len(text),
    };
    let Some((start, end)) = scanner.member_value_span(key_path) else {
        return Ok(None);
    };

    let mut out = String::with_capacity(text.len() + replacement.len());
    out.push_str(&text[..start]);
    out.push_str(replacement);
    out.push_str(&text[end..]);
    validate(&out)?;
    Ok(Some(out))
}

/// Collapse pretty-printed JSON onto one line, the way a single-line document is written.
///
/// A literal newline inside a string is escaped (`\n`) in the serialized text, so splitting on
/// newlines can only ever cut between members.
fn one_line(pretty: &str) -> String {
    pretty
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Prefix every line but the first with `indent`.
fn indent_after_first_line(text: &str, indent: &str) -> String {
    text.replace('\n', &format!("\n{indent}"))
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

    /// Byte range of the *value* of the member addressed by `key_path`, used on the way to a
    /// destination container.
    fn member_value_span(&mut self, key_path: &[String]) -> Option<(usize, usize)> {
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
                    return Some((value_start, value_end));
                }
                let mut nested = Scanner {
                    text: self.text,
                    pos: value_start,
                };
                if let Some(span) = nested.member_value_span(&key_path[1..]) {
                    return Some(span);
                }
            }
        }
    }

    /// Byte range of the object addressed by `key_path` — an empty path is the object at the
    /// scanner's position — as `(open, close)`, the positions of its `{` and `}`.
    fn object_span(&mut self, key_path: &[String]) -> Option<(usize, usize)> {
        if !key_path.is_empty() {
            let (value_start, value_end) = self.member_value_span(key_path)?;
            if self.bytes().get(value_start) != Some(&b'{') {
                return None;
            }
            return Some((value_start, value_end.checked_sub(1)?));
        }

        self.skip_trivia();
        let open = self.pos;
        if self.bytes().get(open) != Some(&b'{') {
            return None;
        }
        let mut probe = Scanner {
            text: self.text,
            pos: open,
        };
        probe.skip_value()?;
        if probe.bytes().get(probe.pos.checked_sub(1)?) != Some(&b'}') {
            return None;
        }
        Some((open, probe.pos - 1))
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

    // The object has no other member, so there is no comma to take: the line the member
    // occupied goes with it. Keeping it would leave a blank, indented line inside a container
    // that the removal was supposed to empty.
    let line_start = text[..start].rfind('\n').map_or(0, |newline| newline + 1);
    let drop = if line_start > 0 && text[line_start..start].trim().is_empty() {
        line_start - 1
    } else {
        start
    };

    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..drop]);
    out.push_str(&text[end..]);
    out
}

/// Insert `member` — the verbatim bytes of a member (`"key": value`) — at the member named
/// `to.last()` inside the object at `to[..len - 1]`, creating the containers that are missing.
fn insert_member(text: &str, to: &[String], member: &str) -> Result<Option<String>, String> {
    let container = &to[..to.len() - 1];

    let Some((depth, (open, close))) = deepest_object(text, container) else {
        return Err("the document has no object that can hold the member".to_string());
    };

    let bytes = text.as_bytes();
    let multi_line = text[open..close].contains('\n');
    let (at, empty) = body_end(text, open, close);
    let indent = line_indent(text, close);
    let child_indent = format!("{indent}  ");

    // Wrap the member — whose own key is the last segment of `to` — in the containers that do
    // not exist yet, so it ends up at `to`. A document that spans lines gets each container on
    // lines of its own, laid out like the indentation around it; a single-line document keeps
    // `{ ... }` on one line.
    let mut wrapped = String::from(member);
    for (level, segment) in container[depth..].iter().enumerate().rev() {
        let key = serde_json::to_string(segment)
            .map_err(|error| format!("cannot encode the key {segment}: {error}"))?;
        if multi_line {
            let own = format!("{child_indent}{}", "  ".repeat(level));
            wrapped = format!("{key}: {{\n{own}  {wrapped}\n{own}}}");
        } else {
            wrapped = format!("{key}: {{ {wrapped} }}");
        }
    }

    let insertion = if empty {
        if multi_line {
            format!("\n{child_indent}{wrapped}")
        } else {
            wrapped
        }
    } else {
        let comma = if bytes[at - 1] == b',' { "" } else { "," };
        if multi_line {
            format!("{comma}\n{child_indent}{wrapped}")
        } else {
            format!("{comma} {wrapped}")
        }
    };

    let mut out = String::with_capacity(text.len() + insertion.len());
    out.push_str(&text[..at]);
    out.push_str(&insertion);
    out.push_str(&text[at..]);
    validate(&out)
        .map_err(|message| format!("the move produced an invalid document: {message}"))?;
    Ok(Some(out))
}

/// The deepest object that already exists on `container`: its index in `container` plus the
/// positions of its braces. The root object is depth 0, so this always finds something unless
/// the document itself is not an object.
fn deepest_object(text: &str, container: &[String]) -> Option<(usize, (usize, usize))> {
    for depth in (0..=container.len()).rev() {
        let mut scanner = Scanner {
            text,
            pos: bom_len(text),
        };
        if let Some(span) = scanner.object_span(&container[..depth]) {
            return Some((depth, span));
        }
    }
    None
}

/// End of the last member (or trailing comma) inside the object body `text[open + 1..close]`,
/// plus whether the body holds a member at all. Trailing whitespace and comments are skipped,
/// so an insertion never lands inside a comment.
fn body_end(text: &str, open: usize, close: usize) -> (usize, bool) {
    let mut scanner = Scanner {
        text,
        pos: open + 1,
    };
    let mut end = open + 1;
    loop {
        scanner.skip_trivia();
        if scanner.pos >= close {
            return (end, end == open + 1);
        }
        let before = scanner.pos;
        match scanner.bytes()[scanner.pos] {
            b',' => scanner.pos += 1,
            b'"' => {
                let _ = scanner.read_string();
                scanner.skip_trivia();
                if scanner.bytes().get(scanner.pos) == Some(&b':') {
                    scanner.pos += 1;
                }
                let _ = scanner.skip_value();
            }
            _ => scanner.pos += 1,
        }
        if scanner.pos <= before {
            return (end, end == open + 1);
        }
        end = scanner.pos;
    }
}

/// Indentation (spaces and tabs) of the line `pos` sits on.
fn line_indent(text: &str, pos: usize) -> String {
    let bytes = text.as_bytes();
    let mut start = pos;
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }
    text[start..pos]
        .chars()
        .take_while(|ch| *ch == ' ' || *ch == '\t')
        .collect()
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
        // The line the member occupied goes with it: an emptied container is not left with a
        // blank, indented line inside.
        assert_eq!(updated, "{\n}\n");
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

    #[test]
    fn moves_a_member_into_an_existing_container() {
        let document = r#"{
  "mcpServers": {
    "linear": { "command": "npx" },
    "github": { "command": "npx" }
  },
  "mcpServersDisabled": {
    "playwright": { "command": "npx" }
  }
}
"#;
        let expected = r#"{
  "mcpServers": {
    "linear": { "command": "npx" }
  },
  "mcpServersDisabled": {
    "playwright": { "command": "npx" },
    "github": { "command": "npx" }
  }
}
"#;
        let updated = move_member(
            document,
            &path(&["mcpServers", "github"]),
            &path(&["mcpServersDisabled", "github"]),
        )
        .unwrap()
        .expect("member exists");

        assert_eq!(
            updated, expected,
            "everything but the move survives byte for byte"
        );
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["mcpServers"].get("github").is_none());
        assert_eq!(value["mcpServersDisabled"]["github"]["command"], "npx");
        assert_eq!(value["mcpServersDisabled"]["playwright"]["command"], "npx");
        assert_eq!(value["mcpServers"]["linear"]["command"], "npx");
    }

    #[test]
    fn creates_a_missing_container_at_the_root() {
        let document = r#"{
  "alpha": 1,
  "mcpServers": {
    "linear": { "command": "npx" },
    "github": { "command": "npx" }
  }
}
"#;
        let expected = r#"{
  "alpha": 1,
  "mcpServers": {
    "linear": { "command": "npx" }
  },
  "mcpServersDisabled": {
    "github": { "command": "npx" }
  }
}
"#;
        let updated = move_member(
            document,
            &path(&["mcpServers", "github"]),
            &path(&["mcpServersDisabled", "github"]),
        )
        .unwrap()
        .expect("member exists");

        assert_eq!(updated, expected);
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["mcpServers"].get("github").is_none());
        assert_eq!(value["mcpServersDisabled"]["github"]["command"], "npx");
        assert_eq!(value["alpha"], 1);
    }

    #[test]
    fn moves_a_member_that_is_followed_by_another_member() {
        let document = r#"{ "a": { "x": 1, "y": 2 }, "b": 3 }"#;
        let updated = move_member(document, &path(&["a", "x"]), &path(&["c", "x"]))
            .unwrap()
            .expect("member exists");

        assert_eq!(updated, r#"{ "a": { "y": 2 }, "b": 3, "c": { "x": 1 } }"#);
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["a"].get("x").is_none());
        assert_eq!(value["a"]["y"], 2);
        assert_eq!(value["b"], 3);
        assert_eq!(value["c"]["x"], 1);
    }

    #[test]
    fn creates_two_missing_trailing_containers() {
        let document = r#"{
  "a": {
    "keep": 1
  },
  "src": {
    "x": { "v": 2 },
    "y": { "v": 3 }
  }
}
"#;
        let updated = move_member(
            document,
            &path(&["src", "x"]),
            &path(&["a", "bDisabled", "x"]),
        )
        .unwrap()
        .expect("member exists");

        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["src"].get("x").is_none());
        assert_eq!(value["src"]["y"]["v"], 3);
        assert_eq!(value["a"]["keep"], 1);
        assert_eq!(value["a"]["bDisabled"]["x"]["v"], 2);
    }

    #[test]
    fn moves_into_an_empty_object() {
        let document = r#"{
  "to": {},
  "from": {
    "a": { "x": 1 },
    "b": 2
  }
}
"#;
        let updated = move_member(document, &path(&["from", "a"]), &path(&["to", "a"]))
            .unwrap()
            .expect("member exists");

        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert_eq!(value["to"]["a"]["x"], 1);
        assert!(value["from"].get("a").is_none());
        assert_eq!(value["from"]["b"], 2);
        assert!(
            !updated.contains(",}"),
            "an empty container gets no leading comma"
        );
    }

    #[test]
    fn moves_into_a_single_line_object() {
        let document = r#"{ "to": { "b": 2 }, "from": { "a": { "x": 1 }, "c": 3 } }"#;
        let updated = move_member(document, &path(&["from", "a"]), &path(&["to", "a"]))
            .unwrap()
            .expect("member exists");

        assert_eq!(
            updated,
            r#"{ "to": { "b": 2, "a": { "x": 1 } }, "from": { "c": 3 } }"#
        );
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert_eq!(value["to"]["a"]["x"], 1);
        assert_eq!(value["to"]["b"], 2);
    }

    #[test]
    fn moves_the_last_member_of_an_object() {
        let document = r#"{ "a": 1, "b": 2 }"#;
        let updated = move_member(document, &path(&["b"]), &path(&["c", "b"]))
            .unwrap()
            .expect("member exists");

        assert_eq!(updated, r#"{ "a": 1, "c": { "b": 2 } }"#);
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert_eq!(value["a"], 1);
        assert_eq!(value["c"]["b"], 2);
    }

    #[test]
    fn moving_the_only_member_leaves_an_empty_container_without_a_blank_line() {
        let document = r#"{
  "mcpServers": {
    "github": { "command": "npx" }
  }
}
"#;
        let updated = move_member(
            document,
            &path(&["mcpServers", "github"]),
            &path(&["mcpServersDisabled", "github"]),
        )
        .unwrap()
        .expect("member exists");

        assert_eq!(
            updated,
            r#"{
  "mcpServers": {
  },
  "mcpServersDisabled": {
    "github": { "command": "npx" }
  }
}
"#
        );
        validate(&updated).unwrap();
    }

    #[test]
    fn keeps_comments_and_trailing_commas_around_the_moved_member() {
        let document = r#"{
  "mcpServers": {
    // github is parked while I test the others
    "github": { "command": "npx" },
    "linear": { "command": "npx" }, // trailing comma + comment
  },
  "note": "keep me",
}
"#;
        let updated = move_member(
            document,
            &path(&["mcpServers", "github"]),
            &path(&["mcpServersDisabled", "github"]),
        )
        .unwrap()
        .expect("member exists");

        validate(&updated).unwrap();
        assert!(updated.contains("// github is parked while I test the others"));
        assert!(updated.contains("// trailing comma + comment"));
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["mcpServers"].get("github").is_none());
        assert_eq!(value["mcpServers"]["linear"]["command"], "npx");
        assert_eq!(value["mcpServersDisabled"]["github"]["command"], "npx");
        assert_eq!(value["note"], "keep me");
    }

    #[test]
    fn carries_comments_that_live_inside_the_moved_value() {
        let document = r#"{
  "a": {
    "x": {
      // travels with the member
      "v": 1
    },
    "y": 2
  },
  "z": 3
}
"#;
        let updated = move_member(document, &path(&["a", "x"]), &path(&["bDisabled", "x"]))
            .unwrap()
            .expect("member exists");

        assert!(updated.contains("// travels with the member"));
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["a"].get("x").is_none());
        assert_eq!(value["a"]["y"], 2);
        assert_eq!(value["bDisabled"]["x"]["v"], 1);
    }

    #[test]
    fn keeps_a_utf8_bom_while_moving() {
        let document = "\u{feff}{\"mcpServers\": { \"x\": { \"url\": \"https://x\" } }, \"n\": 1}";
        let updated = move_member(
            document,
            &path(&["mcpServers", "x"]),
            &path(&["mcpServersDisabled", "x"]),
        )
        .unwrap()
        .expect("member exists");

        assert!(updated.starts_with('\u{feff}'), "the BOM survives the edit");
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert!(value["mcpServers"].get("x").is_none());
        assert_eq!(value["mcpServersDisabled"]["x"]["url"], "https://x");
    }

    #[test]
    fn refuses_an_occupied_destination() {
        let document = r#"{
  "mcpServers": {
    "github": { "command": "npx" },
    "linear": { "command": "npx" }
  }
}
"#;
        let error = move_member(
            document,
            &path(&["mcpServers", "github"]),
            &path(&["mcpServers", "linear"]),
        )
        .unwrap_err();
        assert!(
            error.contains("already exists"),
            "unexpected message: {error}"
        );
        // The document is untouched by a refused move.
        validate(document).unwrap();
        assert!(document.contains("\"github\""));
    }

    #[test]
    fn a_missing_source_is_not_an_error() {
        let document = r#"{ "mcpServers": { "github": { "command": "npx" } } }"#;
        assert!(move_member(
            document,
            &path(&["mcpServers", "nope"]),
            &path(&["mcpServersDisabled", "nope"]),
        )
        .unwrap()
        .is_none());
        assert!(move_member(
            document,
            &path(&["nope"]),
            &path(&["mcpServersDisabled", "nope"])
        )
        .unwrap()
        .is_none());
        assert!(move_member(document, &[], &path(&["x"])).is_err());
        assert!(move_member(document, &path(&["mcpServers"]), &[]).is_err());
    }

    #[test]
    fn a_document_without_a_root_object_has_nothing_to_move() {
        assert!(move_member("[1, 2]", &path(&["a"]), &path(&["b", "a"]))
            .unwrap()
            .is_none());
    }

    #[test]
    fn inserts_into_an_existing_object_like_the_lines_around_it() {
        let updated = insert_new_member(
            CURSOR_LIKE,
            &path(&["mcpServers", "Linear"]),
            &serde_json::json!({ "url": "https://mcp.linear.app/mcp" }),
        )
        .unwrap()
        .expect("the container exists");

        assert_eq!(
            updated,
            r#"{
  "mcpServers": {
    "Context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": {}
    },
    "Figma": {
      "url": "https://mcp.figma.com/mcp",
      "headers": {}
    },
    "Linear": {
      "url": "https://mcp.linear.app/mcp"
    }
    // "chrome-devtools": {
    //   "command": "npx -y chrome-devtools-mcp@latest"
    // }
  },
  "note": "keep me"
}
"#
        );
        validate(&updated).unwrap();
        let value: serde_json::Value = serde_json::from_str(&strip(&updated)).unwrap();
        assert_eq!(
            value["mcpServers"]["Linear"]["url"],
            "https://mcp.linear.app/mcp"
        );
        assert_eq!(
            value["mcpServers"]["Figma"]["url"],
            "https://mcp.figma.com/mcp"
        );
        assert_eq!(value["note"], "keep me");
    }

    #[test]
    fn inserts_nested_containers_into_an_empty_document() {
        let updated = insert_new_member(
            "{\n}\n",
            &path(&["mcp", "servers", "github"]),
            &serde_json::json!({ "command": "npx", "env": { "TOKEN": "x" } }),
        )
        .unwrap()
        .expect("an empty object holds the member");

        validate(&updated).unwrap();
        assert_eq!(
            updated,
            r#"{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "env": {
          "TOKEN": "x"
        }
      }
    }
  }
}
"#
        );
    }

    #[test]
    fn inserts_into_a_single_line_document() {
        let updated = insert_new_member(
            r#"{ "mcpServers": { "a": 1 } }"#,
            &path(&["mcpServers", "b"]),
            &serde_json::json!({ "command": "npx" }),
        )
        .unwrap()
        .expect("the container exists");

        validate(&updated).unwrap();
        assert_eq!(
            updated,
            r#"{ "mcpServers": { "a": 1, "b": { "command": "npx" } } }"#
        );
    }

    #[test]
    fn refuses_to_shadow_an_existing_member() {
        let error = insert_new_member(
            CURSOR_LIKE,
            &path(&["mcpServers", "Figma"]),
            &serde_json::json!({ "url": "https://example.com" }),
        )
        .unwrap_err();
        assert!(
            error.contains("already exists"),
            "unexpected message: {error}"
        );
    }
}
