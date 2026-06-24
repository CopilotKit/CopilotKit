// Doc-swap markers
// -----------------------------------------------------------------------------
// Showcase agents sometimes need harness-only code at runtime (e.g. a helper
// that forwards the `x-aimock-context` header to aimock) that would be wrong
// or unresolvable in a reader's project. Doc-swap markers let a source file
// keep that runtime code live while presenting reader-correct code in the
// generated doc snippets — the substitution is authored in the source itself,
// so the bundler stays framework-agnostic (it never invents a replacement).
//
// Syntax (recognised with `//` or `#` line comments):
//
//     // @doc-replace
//     const model = makeChatOpenAI(config, { model: "gpt-5.4" });
//     // @doc-as
//     // const model = new ChatOpenAI({ model: "gpt-5.4" });
//     // @doc-end
//
// On disk the `@doc-replace` body is the live code that runs; the `@doc-as`
// body is commented out (inert). In bundled snippets, the `@doc-replace` body
// is replaced by the *uncommented* `@doc-as` body. An empty `@doc-as` body
// simply omits the `@doc-replace` body from snippets (e.g. to drop a
// harness-only import that has no reader-facing equivalent).
//
// Marker lines are always stripped from the bundled output. This runs before
// `@region` extraction, so swapped content flows into both the per-file
// `/code` view and any `<Snippet region>` that spans it.

const REPLACE_RE = /@doc-replace\b/;
const AS_RE = /@doc-as\b/;
const END_RE = /@doc-end\b/;
const ANY_RE = /@doc-(?:replace|as|end)\b/;

/**
 * Strip the leading line-comment token from a commented `@doc-as` line,
 * preserving indentation. Handles `//` and `#` comment styles and an optional
 * single following space (so `  //   x` de-comments to `    x`).
 */
function uncomment(line: string): string {
  const m = line.match(/^(\s*)(?:\/\/|#)[ ]?(.*)$/);
  if (!m) return line;
  return m[1] + m[2];
}

/**
 * Apply all `@doc-replace … @doc-as … @doc-end` swaps in a source file.
 * No-op for files without the markers. Throws on malformed/unbalanced blocks
 * so a broken annotation fails the bundle loudly rather than shipping wrong
 * snippet text.
 */
export function applyDocSwaps(content: string, fileLabel = "<source>"): string {
  if (!ANY_RE.test(content)) return content;

  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (END_RE.test(line) || AS_RE.test(line)) {
      throw new Error(
        `${fileLabel}: stray "${line.trim()}" without a preceding @doc-replace.`,
      );
    }

    if (!REPLACE_RE.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    // Collect the replace body up to @doc-as.
    i++;
    while (i < lines.length && !AS_RE.test(lines[i])) {
      if (REPLACE_RE.test(lines[i]) || END_RE.test(lines[i])) {
        throw new Error(
          `${fileLabel}: expected @doc-as before "${lines[i].trim()}".`,
        );
      }
      i++; // replace-body lines are discarded from snippet output
    }
    if (i >= lines.length) {
      throw new Error(`${fileLabel}: @doc-replace without a matching @doc-as.`);
    }

    // Collect the as-body up to @doc-end, uncommenting each line.
    i++;
    const asBody: string[] = [];
    while (i < lines.length && !END_RE.test(lines[i])) {
      if (REPLACE_RE.test(lines[i]) || AS_RE.test(lines[i])) {
        throw new Error(
          `${fileLabel}: expected @doc-end before "${lines[i].trim()}".`,
        );
      }
      asBody.push(uncomment(lines[i]));
      i++;
    }
    if (i >= lines.length) {
      throw new Error(`${fileLabel}: @doc-as without a matching @doc-end.`);
    }

    // Skip the @doc-end marker line.
    i++;

    for (const b of asBody) out.push(b);
  }

  return out.join("\n");
}
