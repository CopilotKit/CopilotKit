// Serialize the runtime config for inline injection into the root
// layout's `<script>...</script>` block. Three substrings would
// otherwise break out of (or corrupt) the parser:
//
//   - `<` -- guards against the `</script>` breakout (XSS). JSON.stringify
//     does NOT escape `<` by default, so a URL containing `</script>`
//     (e.g. a hostile env value) would terminate the inline script and
//     inject HTML. Escape every `<` to `<` so the substring
//     `</script>` can never appear.
//   - U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) -- legal
//     inside JSON strings, but a syntax error inside a JS string literal
//     in older engines / when the page is parsed as `text/javascript`.
//     Escape both.
//
// Tokenizer note: the U+2028 / U+2029 codepoints in the RegExp argument
// are written as six-character ASCII backslash-u escape sequences,
// resolved at runtime by the regex engine, NOT as the literal Unicode
// codepoints. A formatter or editor that silently normalizes line
// terminators could otherwise strip the literal codepoints, leaving a
// regex that matches nothing and a security-critical XSS escape that
// silently no-ops. The escape-string form is robust to any such
// formatter pass. This file MUST NOT contain the literal U+2028 or
// U+2029 bytes anywhere in its source.
//
// Canonical OWASP-recommended escape for inline JSON in HTML.

export function serializeRuntimeConfig(cfg: unknown): string {
  return JSON.stringify(cfg)
    .replace(new RegExp("<", "g"), "\\u003c")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}
