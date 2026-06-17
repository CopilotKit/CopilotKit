// Serialize the runtime config for inline injection into the root
// layout's `<script>...</script>` block. Three substrings would
// otherwise break out of (or corrupt) the parser:
//
//   - `<` — guards against the `</script>` breakout (XSS). JSON.stringify
//     does NOT escape `<` by default, so a URL containing `</script>`
//     (e.g. a hostile env value) would terminate the inline script and
//     inject HTML. Escape every `<` to `<` so the substring
//     `</script>` can never appear.
//   - U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) — legal
//     inside JSON strings, but a syntax error inside a JS string literal
//     in older engines / when the page is parsed as `text/javascript`.
//     Escape both.
//
// Tokenizer note: writing the literal U+2028 / U+2029 codepoints inside
// a /regex/ literal is a parse error in TypeScript / many JS engines
// because both codepoints are line terminators that prematurely
// terminate the regex literal. Constructing via the RegExp constructor
// with `\u` escapes — resolved at runtime by the regex engine —
// sidesteps the tokenizer entirely.
//
// Canonical OWASP-recommended escape for inline JSON in HTML.

export function serializeRuntimeConfig(cfg: unknown): string {
  return JSON.stringify(cfg)
    .replace(new RegExp("<", "g"), "\\u003c")
    .replace(new RegExp(" ", "g"), "\\u2028")
    .replace(new RegExp(" ", "g"), "\\u2029");
}
