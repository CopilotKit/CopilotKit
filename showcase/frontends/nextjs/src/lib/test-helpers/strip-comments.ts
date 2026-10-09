/**
 * ONE comment stripper, shared by every source-text scan in this app.
 *
 * WHY IT IS SHARED. This function used to exist as two byte-identical copies,
 * in `src/app/[integration]/demos/layout.test.tsx` and
 * `src/lib/in-process-agents.test.ts`. Both scans FAIL OPEN — a shape the
 * stripper mishandles silently removes text, and removed text cannot match an
 * offender pattern. Two copies means one can be hardened while the other keeps
 * the hole, and the weaker copy is the one guarding the `next/link` import
 * (i.e. the soft-navigation regression). Shared, a fix lands once.
 *
 * WHAT IT DOES. Removes `//` line comments and block comments, and leaves the
 * bodies of strings and template literals alone. A character-by-character pass,
 * not a regex: blanking `//` to end-of-line also truncates a line whose `//`
 * sits inside a string (`` `https://…` ``), and the truncated tail can hide a
 * real offender. Newlines inside removed comments are preserved so offender
 * text and line numbers still read sensibly.
 *
 * KNOWN LIMIT, MADE LOUD INSTEAD OF FIXED. This is not a JavaScript lexer.
 * `${…}` inside a template literal is treated as string content, and a REGEX
 * LITERAL is not recognised at all — so a regex containing a quote, such as
 * `` /["']/ ``, flips the scanner into string mode and swallows source up to
 * the next matching quote. Full regex-literal lexing needs the
 * regex-vs-division disambiguation, which needs a real parser; that is out of
 * proportion here. Instead `stripCommentsWithMode` reports the mode the scan
 * ENDED in. A well-formed file always ends in `code`; anything else means the
 * scanner got lost and swallowed a tail. Callers assert that, so a future
 * desync goes RED instead of quietly scanning less than it claims.
 */

/** The scanner state. Anything but `code` at end-of-input means it got lost. */
export type StripMode = "code" | "line" | "block" | "'" | '"' | "`";

export interface StripResult {
  /** The source with comments removed. */
  code: string;
  /** The mode the scan ended in. `code` for any well-formed file. */
  endMode: StripMode;
}

/** Strip comments and report the mode the scan ended in. */
export function stripCommentsWithMode(source: string): StripResult {
  let mode: StripMode = "code";
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (ch === "/" && next === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") mode = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (ch === "\n") {
        mode = "code";
        out += ch;
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i += 1;
      continue;
    }
    // Inside a string or template literal: copy verbatim, honour escapes.
    out += ch;
    if (ch === "\\") {
      if (next !== undefined) out += next;
      i += 2;
      continue;
    }
    if (ch === mode) mode = "code";
    i += 1;
  }
  // A line comment running to EOF without a newline is well-formed source, so
  // it is not a "got lost" signal.
  return { code: out, endMode: mode === "line" ? "code" : mode };
}

/** Strip comments, discarding the end-mode signal. */
export function stripComments(source: string): string {
  return stripCommentsWithMode(source).code;
}
