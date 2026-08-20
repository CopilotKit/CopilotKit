/**
 * Test-Vacuity + Constant-Drift Gate — core analysis
 *
 * WHY THIS EXISTS
 * ---------------
 * PR #6156 went through two 12-reviewer code-review rounds. A convergence
 * audit measured that **16 of 37 round-2 "toothless guard" clusters (43%) lived
 * in files the round-1 fixes had just created**. Two defect classes accounted
 * for most of them, and both are mechanically detectable from test source text:
 *
 *   A1 — DEGENERATE-INPUT VACUITY. An assertion that is satisfied when the
 *        thing it claims to pin never ran. The canonical shape:
 *
 *            expect(Math.max(...pages)).toBeLessThanOrEqual(CAP);
 *
 *        `Math.max(...[])` is `-Infinity` and `Math.min(...[])` is `+Infinity`,
 *        so that assertion passes when ZERO pages were fetched — i.e. it also
 *        passes for a hook that never issued a request at all. Same shape via
 *        an aggregate (`.every`/`.reduce`) over a `.filter(...)` whose result
 *        may be empty: `[].every(p)` is `true` for every predicate `p`.
 *
 *   A2 — ONE-SIDED / HAND-COPIED PINS. A "drift guard" that only catches drift
 *        in one direction, or a constant hand-copied from the module it claims
 *        to mirror. Real instance: `EXPECTED_MAX_INITIAL_PAGES = 20` was
 *        asserted ONLY as `toBeLessThanOrEqual`, and reviewers PROVED that
 *        lowering the production `MAX_INITIAL_FETCH_PAGES` to 10 — and even to
 *        5 — left the whole suite green. The unguarded direction was the
 *        harmful one (a silently narrowed first-paint budget is the exact bug
 *        that PR was fixing).
 *
 * A third rule covers the duplicated-constant case that has no test-file
 * expression at all: two product modules each declaring their own copy of the
 * same tuned value with nothing asserting the two equal
 * (`COMM_ERROR_FUTURE_SKEW_TOLERANCE_MS` in `cell-model.ts` vs
 * `FUTURE_SKEW_TOLERANCE_MS` in `staleness.ts`). That rule lives in
 * `checkDuplicatedConstants` and is driven by an explicit registry, because
 * "these two constants are knowingly duplicated" is a human declaration, not
 * something a scanner can infer.
 *
 * DESIGN
 * ------
 * The scanner is deliberately NOT a bare grep for the literal idioms found in
 * review — a trivially reworded equivalent must not slip past. So:
 *
 *   - it MASKS comments, strings, template literals and regex literals first
 *     (length-preserving, so byte offsets and line numbers stay exact), then
 *     matches parens by depth. `expect("Math.max(...xs)")` in a string, or in
 *     a comment, is not code and is not flagged;
 *   - `Math.max(...xs)` is flagged whether it sits INSIDE the `expect(...)`
 *     call or is hoisted into a `const` that an `expect(...)` later consumes;
 *   - the "is it guarded?" question is answered by looking for a real
 *     non-emptiness precondition on the SAME collection expression
 *     (`toHaveLength(n>0)`, `.length` compared above zero, `toContain(...)`,
 *     `toEqual([non-empty])`), not by the mere presence of the word "length".
 *
 * A pure-text scanner cannot be a type checker, so it is scoped to shapes where
 * a text match IS the defect. Everything it reports names a file, a line, the
 * offending symbol, and why the assertion holds on the degenerate input.
 *
 * OPT-OUT
 * -------
 * A line may carry `vacuity-gate-allow: <rule-id> — <reason>` (in a comment on
 * the offending line or the line directly above). The reason is MANDATORY and
 * must be at least {@link MIN_OPT_OUT_REASON_LENGTH} characters; a marker with
 * no reason is itself reported as `opt-out-without-reason`, so the escape hatch
 * cannot be used to silence the gate wordlessly.
 *
 * This module is pure: text in, violations out. No filesystem, no process exit.
 * `validate-test-vacuity.ts` owns IO, the allowlist and the exit code.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleId =
  | "degenerate-spread-aggregate"
  | "degenerate-filtered-aggregate"
  | "one-sided-tuned-constant"
  | "pin-comment-without-import"
  | "duplicated-constant-drift"
  | "opt-out-without-reason";

export interface Violation {
  rule: RuleId;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line number in the ORIGINAL source. */
  line: number;
  /**
   * The thing the violation is about — the collection expression, the constant
   * name, the referenced identifier. Together with `rule` + `file` this is the
   * allowlist key, so it must be stable across unrelated edits to the file
   * (which is why the line number is NOT part of the key).
   */
  symbol: string;
  /** One-line explanation, ready to print. */
  message: string;
}

/** Minimum length of the justification an inline opt-out marker must carry. */
export const MIN_OPT_OUT_REASON_LENGTH = 15;

/**
 * Phrases in a leading comment that declare "this literal is a pin against
 * another module's value". Any constant so annotated is treated as a TUNED
 * CONSTANT and must be pinned two-sidedly. This is the "declared set" the
 * one-sided-pin rule needs: authors opt IN by writing the intent down, which
 * they already do — `EXPECTED_MAX_INITIAL_PAGES`'s own JSDoc says both
 * "MUST match `MAX_INITIAL_FETCH_PAGES`" and "pinned as a literal here on
 * purpose".
 */
const PIN_INTENT_PATTERNS: readonly RegExp[] = [
  /\bMUST\s+match\b/i,
  /\bmust\s+equal\b/i,
  /\bpinned\s+as\s+a\s+literal\b/i,
  /\bdrift\s+guard\b/i,
  /\bkeep\s+in\s+(?:lockstep|sync)\b/i,
  /\bmirrors?\s+(?:the\s+)?(?:production|source|engine)\b/i,
];

// ---------------------------------------------------------------------------
// Masking: strip non-code, keep byte offsets
// ---------------------------------------------------------------------------

/**
 * Replace every comment, string literal, template literal and regex literal
 * body with spaces, preserving total length and every newline. Byte offsets and
 * line numbers in the result therefore map 1:1 onto the original source, which
 * lets the rules match on masked text and report positions in the real file.
 *
 * Template literals are masked WHOLESALE, including any `${...}` substitution.
 * That is a deliberate false-negative: an assertion buried inside a template
 * substitution is not a shape this gate is trying to catch, and tracking nested
 * template/expression state is exactly the kind of hand-rolled lexing that goes
 * wrong. Everything else is masked precisely.
 */
/** A comment, with its offsets in the ORIGINAL source. */
export interface CommentBlock {
  text: string;
  start: number;
  end: number;
}

export interface MaskedSource {
  /** Length-identical copy of `src` with all non-code blanked out. */
  masked: string;
  /** Every comment, in source order, with original offsets. */
  comments: CommentBlock[];
}

/**
 * Single lexing pass: blank non-code AND record where the comments were.
 *
 * These MUST come from one pass. An earlier version re-derived comment
 * boundaries by looking for `//` at a position the mask had blanked — but string
 * literals are blanked too, so `"// vacuity-gate-allow: x"` inside a string
 * registered as a comment. One pass, one answer.
 */
export function maskAndExtract(src: string): MaskedSource {
  const n = src.length;
  const comments: CommentBlock[] = [];
  // Char-code buffer rather than a string array: this runs over ~1,200 test
  // files on every CI invocation, and per-char string/regex work dominated the
  // first implementation's runtime.
  const out = new Uint16Array(n);
  for (let k = 0; k < n; k++) out[k] = src.charCodeAt(k);
  const SPACE = 32;
  const NEWLINE = 10;
  let i = 0;
  /** Last non-whitespace character of actual code seen so far. */
  let prev = "";

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== NEWLINE) out[k] = SPACE;
    }
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // Line comment.
    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      comments.push({ text: src.slice(i, j), start: i, end: j });
      blank(i, j);
      i = j;
      continue;
    }

    // Block comment.
    if (c === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      comments.push({ text: src.slice(i, end), start: i, end });
      blank(i, end);
      i = end;
      continue;
    }

    // String literal.
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c || src[j] === "\n") break;
        j++;
      }
      const end = Math.min(j + 1, n);
      blank(i, end);
      prev = c;
      i = end;
      continue;
    }

    // Template literal (masked wholesale — see the doc comment).
    if (c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "`") break;
        j++;
      }
      const end = Math.min(j + 1, n);
      blank(i, end);
      prev = "`";
      i = end;
      continue;
    }

    // Regex literal. `/` is division when the previous meaningful character
    // could end an expression (identifier char, `)`, `]`); otherwise it opens a
    // regex. Conservative, and unit-tested against the shapes that actually
    // appear in these suites (`/https?:\/\//`, character classes with `/`).
    if (c === "/" && !isExpressionEnd(prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "\n") break; // unterminated — bail, treat as division
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        blank(i, j + 1);
        prev = "/";
        i = j + 1;
        continue;
      }
      // Fall through: treat as a division operator.
    }

    const code = src.charCodeAt(i);
    // Not whitespace: space, tab, LF, CR, VT, FF, NBSP.
    if (
      code !== 32 &&
      code !== 9 &&
      code !== 10 &&
      code !== 13 &&
      code !== 11 &&
      code !== 12 &&
      code !== 160
    ) {
      prev = c;
    }
    i++;
  }

  // Chunked to stay clear of the argument-count limit on large files.
  let masked = "";
  const CHUNK = 8192;
  for (let k = 0; k < n; k += CHUNK) {
    masked += String.fromCharCode(...out.subarray(k, Math.min(k + CHUNK, n)));
  }
  return { masked, comments };
}

/** Length-preserving mask of every comment/string/template/regex. */
export function maskNonCode(src: string): string {
  return maskAndExtract(src).masked;
}

/** Could this character terminate an expression (so a following `/` divides)? */
function isExpressionEnd(ch: string): boolean {
  return ch !== "" && (/[A-Za-z0-9_$)\]]/.test(ch) || ch === "`");
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------

/**
 * 1-based line number of a byte offset.
 *
 * Memoized on the most recent source string (we process one file at a time).
 * The naive O(index) scan was the runtime hot spot: the tuned-constant rule
 * asks for the line of every comment for every numeric declaration, which made
 * the whole gate quadratic in file size.
 */
let lineStartsCacheSrc: string | null = null;
let lineStartsCache: number[] = [];

function lineStartsFor(src: string): number[] {
  if (lineStartsCacheSrc === src) return lineStartsCache;
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) starts.push(i + 1);
  }
  lineStartsCacheSrc = src;
  lineStartsCache = starts;
  return starts;
}

export function lineOf(src: string, index: number): number {
  const starts = lineStartsFor(src);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Index of the `)` matching the `(` at `openIdx`, or -1 if unbalanced. Runs on
 * MASKED source, so parens inside strings/comments/regexes cannot skew it.
 */
export function matchParen(masked: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Collapse all whitespace runs to single spaces and trim. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Normalize a single call argument. Prettier wraps long matcher calls, leaving a
 * DANGLING COMMA in the argument text:
 *
 *     expect(pages.length).toBeLessThanOrEqual(
 *       EXPECTED_MAX_INITIAL_PAGES,
 *     );
 *
 * Without stripping it, `arg === "EXPECTED_MAX_INITIAL_PAGES,"` never equals the
 * constant name and the one-sided-pin rule silently sees zero assertions — which
 * is precisely the "guard that quietly stops guarding" failure this gate exists
 * to prevent, so it is unit-tested in both the wrapped and unwrapped forms.
 */
function normArg(s: string): string {
  return norm(s).replace(/,+$/, "").trim();
}

/** Split an argument list on TOP-LEVEL commas (paren/bracket/brace aware). */
function splitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

/** Leading identifier of an expression (`pages.filter(x)` -> `pages`). */
function baseIdentifier(expr: string): string {
  const m = /^[A-Za-z_$][\w$]*/.exec(expr.trim());
  return m ? m[0] : expr.trim();
}

// ---------------------------------------------------------------------------
// expect(...) discovery
// ---------------------------------------------------------------------------

interface ExpectCall {
  /** Offset of the `e` in `expect`. */
  start: number;
  /** Offset of the `(` opening the argument list. */
  openIdx: number;
  /** Offset of the matching `)`. */
  closeIdx: number;
  /** Raw (masked) subject text between the parens. */
  subject: string;
  /**
   * The chained matcher text following the closing paren, up to the end of the
   * statement — e.g. `.toBeLessThanOrEqual(CAP)` or `.not.toHaveLength(0)`.
   */
  tail: string;
}

/** Every `expect(...)` call in the masked source, with subject and matcher. */
function findExpectCalls(masked: string): ExpectCall[] {
  const calls: ExpectCall[] = [];
  const re = /\bexpect\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(masked, openIdx);
    if (closeIdx === -1) continue;
    // Matcher tail: everything up to the statement terminator. `;` is the
    // common case; a newline followed by a non-`.`/non-`)` char also ends it
    // (prettier splits long chains across lines).
    let end = closeIdx + 1;
    let depth = 0;
    while (end < masked.length) {
      const c = masked[end];
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      } else if (c === ";" && depth === 0) break;
      end++;
    }
    // vitest/jest accept a second "message" argument — `expect(x, "why")` —
    // which several showcase suites use heavily. The SUBJECT is the first
    // top-level argument only; taking the whole argument list made every
    // annotated assertion unrecognisable, so a correctly-written
    // `expect(indices.length, "...").toBeGreaterThan(0)` guard was invisible.
    const rawArgs = masked.slice(openIdx + 1, closeIdx);
    calls.push({
      start: m.index,
      openIdx,
      closeIdx,
      subject: splitTopLevel(rawArgs)[0] ?? rawArgs,
      tail: masked.slice(closeIdx + 1, end),
    });
    re.lastIndex = closeIdx;
  }
  return calls;
}

/**
 * Collection expressions this file proves NON-EMPTY, normalized. A guard counts
 * only if it forces at least one element:
 *
 *   expect(xs).toHaveLength(3)              -> xs
 *   expect(xs).not.toHaveLength(0)          -> xs
 *   expect(xs.length).toBeGreaterThan(0)    -> xs
 *   expect(xs.length).toBeGreaterThanOrEqual(1) -> xs
 *   expect(xs.length).toBe(4)               -> xs
 *   expect(xs).toContain(7)                 -> xs
 *   expect(xs).toEqual([1, 2])              -> xs
 *
 * `toHaveLength(0)`, `toEqual([])` and `toBeGreaterThanOrEqual(0)` prove
 * nothing and are deliberately NOT guards — they are satisfied by the empty
 * input, which is the whole defect.
 */
function collectNonEmptyGuards(masked: string): Set<string> {
  const guards = new Set<string>();
  /**
   * `for (const [name, xs] of Object.entries(obj))` / `for (const xs of
   * Object.values(obj))` — guarding the loop ALIAS guards every property of the
   * object, which is how a suite says "no bucket may be empty" in one place.
   * Recorded as `obj.*` and consulted by {@link isGuarded}.
   */
  const loopAliases: Array<{ alias: string; object: string }> = [];
  const loopRe =
    /\bfor\s*\(\s*(?:const|let|var)\s+(?:\[\s*[A-Za-z_$][\w$]*\s*,\s*([A-Za-z_$][\w$]*)\s*\]|([A-Za-z_$][\w$]*))\s+of\s+Object\s*\.\s*(?:entries|values)\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)/g;
  let loop: RegExpExecArray | null;
  while ((loop = loopRe.exec(masked)) !== null) {
    loopAliases.push({ alias: loop[1] ?? loop[2], object: loop[3] });
  }
  for (const call of findExpectCalls(masked)) {
    const subject = norm(call.subject);
    const tail = norm(call.tail);
    const negated = /^\.\s*not\s*\./.test(tail);

    const lengthMatch = /^(.*)\.length$/.exec(subject);
    const target = lengthMatch ? norm(lengthMatch[1]) : subject;

    // The tail always begins at the `.` after `expect(...)`; the matcher is the
    // first identifier after an optional `not.`, e.g. `.not.toHaveLength(0)`.
    const matcher = /^\.\s*(?:not\s*\.\s*)?([A-Za-z]\w*)\s*\(/.exec(tail);
    if (!matcher) continue;
    const name = matcher[1];
    const argOpen = matcher[0].length - 1;
    const argClose = matchParen(tail, argOpen);
    const arg =
      argClose === -1 ? "" : normArg(tail.slice(argOpen + 1, argClose));
    const numeric = Number(arg);

    if (!negated && lengthMatch) {
      if (
        (name === "toBeGreaterThan" &&
          Number.isFinite(numeric) &&
          numeric >= 0) ||
        (name === "toBeGreaterThanOrEqual" &&
          Number.isFinite(numeric) &&
          numeric >= 1) ||
        ((name === "toBe" || name === "toEqual" || name === "toStrictEqual") &&
          Number.isFinite(numeric) &&
          numeric > 0)
      ) {
        guards.add(target);
      }
      continue;
    }

    if (!negated) {
      if (name === "toHaveLength" && Number.isFinite(numeric) && numeric > 0) {
        guards.add(target);
      } else if (name === "toContain" || name === "toContainEqual") {
        guards.add(target);
      } else if (
        (name === "toEqual" || name === "toStrictEqual") &&
        /^\[\s*[^\]\s]/.test(arg)
      ) {
        // Non-empty array literal. The character class must EXCLUDE `]`:
        // `/^\[\s*\S/` matched `[]`, which turned `expect(xs).toEqual([])` --
        // the single strongest statement that the collection IS empty -- into a
        // non-emptiness guard.
        guards.add(target);
      }
    } else if (name === "toHaveLength" && numeric === 0) {
      // `expect(xs).not.toHaveLength(0)` — an explicit non-emptiness pin.
      guards.add(target);
    }
  }
  for (const { alias, object } of loopAliases) {
    if (guards.has(alias)) guards.add(`${object}.*`);
  }
  return guards;
}

// ---------------------------------------------------------------------------
// Opt-out markers
// ---------------------------------------------------------------------------

const OPT_OUT_RE = /vacuity-gate-allow\s*:\s*([a-z-]+)\s*(?:[—:-]\s*)?(.*)$/;

interface OptOut {
  rule: string;
  reason: string;
  line: number;
}

/**
 * Parse every `vacuity-gate-allow:` marker out of the source's COMMENTS.
 *
 * Comments only — a marker inside a string literal is data, not a directive.
 * (This file's own test suite embeds marker text inside fixture strings; reading
 * markers line-wise made the gate flag its own test file.)
 */
function findOptOuts(src: string, comments: readonly CommentBlock[]): OptOut[] {
  const found: OptOut[] = [];
  for (const comment of comments) {
    for (const raw of comment.text.split("\n")) {
      const m = OPT_OUT_RE.exec(raw);
      if (!m) continue;
      const offsetInComment = comment.text.indexOf(raw);
      found.push({
        rule: m[1],
        reason: m[2]
          .trim()
          .replace(/\*\/\s*$/, "")
          .trim(),
        line: lineOf(src, comment.start + Math.max(offsetInComment, 0)),
      });
    }
  }
  return found;
}

/**
 * Is `rule` opted out at `line`? A marker applies to its own line and to the
 * line directly below it (the usual "comment above the code" placement).
 */
function isOptedOut(optOuts: OptOut[], rule: RuleId, line: number): boolean {
  return optOuts.some(
    (o) =>
      o.rule === rule &&
      o.reason.length >= MIN_OPT_OUT_REASON_LENGTH &&
      (o.line === line || o.line === line - 1),
  );
}

// ---------------------------------------------------------------------------
// Rule A1 — degenerate-input vacuity
// ---------------------------------------------------------------------------

/**
 * Aggregates that are DEFINED on the empty collection and therefore assert
 * nothing about it: `Math.max(...[]) === -Infinity` (so any upper bound holds),
 * `Math.min(...[]) === +Infinity` (so any lower bound holds), `[].every(p) ===
 * true` for every predicate, and `[].reduce(f, seed) === seed`.
 */
const SPREAD_AGGREGATE_RE = /\bMath\s*\.\s*(max|min)\s*\(/g;
const FILTERED_AGGREGATE_RE = /\.\s*(every|reduce|reduceRight)\s*\(/g;

/** Array operations that can make the result SHORTER than their input. */
const CARDINALITY_CHANGING_RE = /\.\s*(?:filter|flatMap|slice|splice)\s*\(/;

/**
 * Is `collection` proven non-empty by `guards`?
 *
 * `derived` collections (those built with a cardinality-changing op) must be
 * guarded as a WHOLE expression. Everything else may also be guarded via its
 * base identifier, or via a `<obj>.*` wildcard produced by a loop that guards
 * every property of an object (see {@link collectNonEmptyGuards}).
 */
function isGuarded(
  guards: Set<string>,
  collection: string,
  derived: boolean,
): boolean {
  if (guards.has(collection)) return true;
  if (derived) return false;
  if (guards.has(baseIdentifier(collection))) return true;
  const member = /^([A-Za-z_$][\w$.]*)\.[A-Za-z_$][\w$]*$/.exec(collection);
  return member !== null && guards.has(`${member[1]}.*`);
}

function checkDegenerateAggregates(
  file: string,
  src: string,
  masked: string,
  optOuts: OptOut[],
): Violation[] {
  const violations: Violation[] = [];
  const guards = collectNonEmptyGuards(masked);
  const expects = findExpectCalls(masked);

  const insideExpect = (idx: number): ExpectCall | undefined =>
    expects.find((e) => idx > e.openIdx && idx < e.closeIdx);

  /** Names bound by `const NAME = <expr containing idx>`. */
  const boundName = (idx: number): string | undefined => {
    const from = Math.max(
      masked.lastIndexOf(";", idx),
      masked.lastIndexOf("{", idx),
      masked.lastIndexOf("}", idx),
      masked.lastIndexOf("\n", idx),
    );
    const prefix = masked.slice(from + 1, idx);
    const m =
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/.exec(
        prefix.replace(/\s+$/, " "),
      );
    return m?.[1];
  };

  /** Is `name` later consumed by an `expect(...)` subject? */
  const consumedByExpect = (name: string, after: number): boolean =>
    expects.some(
      (e) =>
        e.openIdx > after &&
        new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(e.subject),
    );

  const report = (
    rule: RuleId,
    idx: number,
    symbol: string,
    message: string,
  ): void => {
    const line = lineOf(src, idx);
    if (isOptedOut(optOuts, rule, line)) return;
    violations.push({ rule, file, line, symbol, message });
  };

  // --- Math.max/min over a spread ------------------------------------------
  SPREAD_AGGREGATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPREAD_AGGREGATE_RE.exec(masked)) !== null) {
    const fn = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(masked, openIdx);
    if (closeIdx === -1) continue;
    const args = splitTopLevel(masked.slice(openIdx + 1, closeIdx));
    const spread = args.map(norm).find((a) => a.startsWith("..."));
    if (!spread) continue; // Math.max(a, b) has fixed arity — not degenerate.
    const collection = spread.slice(3).trim();
    if (collection === "") continue;

    // Only flag when the value reaches an assertion — a spread aggregate used
    // to build a fixture is not making a claim.
    const enclosing = insideExpect(m.index);
    let reached = Boolean(enclosing);
    if (!reached) {
      const name = boundName(m.index);
      reached = Boolean(name && consumedByExpect(name, closeIdx));
    }
    if (!reached) continue;

    // `.map(...)` PRESERVES cardinality, so guarding the base identifier is
    // sufficient for `Math.max(...xs.map(f))`. `.filter`/`.flatMap`/`.slice`
    // do not: a guarded base can still yield an empty derived set, so those
    // demand a guard on the whole expression.
    const derived = CARDINALITY_CHANGING_RE.test(collection);
    if (isGuarded(guards, collection, derived)) continue;

    const empty = fn === "max" ? "-Infinity" : "+Infinity";
    const bound = fn === "max" ? "upper" : "lower";
    report(
      derived ? "degenerate-filtered-aggregate" : "degenerate-spread-aggregate",
      m.index,
      collection,
      `Math.${fn}(...${collection}) is ${empty} when \`${collection}\` is empty, so this ${bound} bound is satisfied by a run that produced ZERO elements — it pins nothing.` +
        ` Add a non-emptiness precondition (e.g. expect(${collection}).not.toHaveLength(0), or assert the expected element is present) before the bound.` +
        (derived
          ? ` Guarding \`${baseIdentifier(collection)}\` is not enough: the derived/filtered set can still be empty.`
          : ""),
    );
  }

  // --- .every()/.reduce() over a filtered collection, inside expect() ------
  for (const call of expects) {
    FILTERED_AGGREGATE_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = FILTERED_AGGREGATE_RE.exec(call.subject)) !== null) {
      const before = call.subject.slice(0, a.index);
      const filterIdx = before.search(/\.\s*(?:filter|flatMap)\s*\(/);
      if (filterIdx === -1) continue;
      const collection = norm(before);
      if (collection === "") continue;
      if (isGuarded(guards, collection, true)) continue;
      const idx = call.openIdx + 1 + a.index;
      const aggregate = a[1];
      const degenerate =
        aggregate === "every"
          ? "[].every(p) is true for EVERY predicate"
          : "[].reduce(f, seed) returns seed unchanged";
      report(
        "degenerate-filtered-aggregate",
        idx,
        collection,
        `\`.${aggregate}(...)\` aggregates the FILTERED collection \`${collection}\`, which can be empty — ${degenerate}, so this assertion is satisfied when the filter matched nothing.` +
          ` Pin the filtered set's size first (e.g. expect(${collection}).toHaveLength(<n>)), then assert over it.`,
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Rule A2 — one-sided pins and hand-copied source-of-truth
// ---------------------------------------------------------------------------

const UPPER_MATCHERS = new Set(["toBeLessThanOrEqual", "toBeLessThan"]);
const LOWER_MATCHERS = new Set(["toBeGreaterThanOrEqual", "toBeGreaterThan"]);
const EXACT_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toContain",
  "toContainEqual",
  "toHaveLength",
  "toBeCloseTo",
]);

/** An explicitly declared tuned constant: `{file, constant, reason}`. */
export interface TunedConstantEntry {
  file: string;
  constant: string;
  reason: string;
}

/**
 * Which numeric constants in this file are TUNED — i.e. are asserted as a pin
 * on a value owned elsewhere, so a one-directional assertion is a bug. Two
 * sources: an immediately-preceding comment declaring pin intent, or an entry
 * in the explicit registry.
 */
function findTunedConstants(
  file: string,
  src: string,
  masked: string,
  comments: readonly CommentBlock[],
  registry: readonly TunedConstantEntry[],
): Array<{ name: string; index: number }> {
  const declared = new Set(
    registry.filter((e) => e.file === file).map((e) => e.constant),
  );
  const out: Array<{ name: string; index: number }> = [];
  const re =
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const name = m[1];
    const init = norm(m[2]);
    // Numeric literal, or a product/sum of numeric literals (5 * 60 * 1000).
    if (!/^[\d_.\s*+\-/()]+$/.test(init)) continue;
    if (declared.has(name)) {
      out.push({ name, index: m.index });
      continue;
    }
    // Leading comment: the nearest comment ending within 3 lines above.
    const declLine = lineOf(src, m.index);
    const lead = comments.find((c) => {
      const endLine = lineOf(src, c.end);
      return endLine >= declLine - 3 && endLine <= declLine;
    });
    if (lead && PIN_INTENT_PATTERNS.some((p) => p.test(lead.text))) {
      out.push({ name, index: m.index });
    }
  }
  return out;
}

function checkOneSidedPins(
  file: string,
  src: string,
  masked: string,
  comments: readonly CommentBlock[],
  optOuts: OptOut[],
  registry: readonly TunedConstantEntry[],
): Violation[] {
  const violations: Violation[] = [];
  const tuned = findTunedConstants(file, src, masked, comments, registry);
  if (tuned.length === 0) return violations;

  // Every matcher call in the file, with its (masked) argument text and
  // whether it sits behind `.not.`.
  interface MatcherUse {
    name: string;
    arg: string;
    negated: boolean;
    index: number;
  }
  const uses: MatcherUse[] = [];
  const re = /\.\s*(not\s*\.\s*)?([A-Za-z]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(masked, openIdx);
    if (closeIdx === -1) continue;
    uses.push({
      name: m[2],
      arg: normArg(masked.slice(openIdx + 1, closeIdx)),
      negated: Boolean(m[1]),
      index: m.index,
    });
  }

  for (const { name, index } of tuned) {
    // Only BARE uses of the constant pin it. `CAP + 1` pins the neighbour, not
    // the constant — which is exactly how the real `EXPECTED_MAX_INITIAL_PAGES`
    // guard convinced its author it was two-sided while lowering the
    // production constant to 5 kept the suite green.
    const bare = uses.filter((u) => u.arg === name && !u.negated);
    let upper = 0;
    let lower = 0;
    let exact = 0;
    for (const u of bare) {
      if (UPPER_MATCHERS.has(u.name)) upper++;
      else if (LOWER_MATCHERS.has(u.name)) lower++;
      else if (EXACT_MATCHERS.has(u.name)) exact++;
    }
    if (exact > 0) continue;
    if (upper === 0 && lower === 0) continue; // not asserted as a bound at all
    if (upper > 0 && lower > 0) continue; // genuinely two-sided
    const line = lineOf(src, index);
    if (isOptedOut(optOuts, "one-sided-tuned-constant", line)) continue;
    const held = upper > 0 ? "an UPPER" : "a LOWER";
    const missed = upper > 0 ? "LOWERED" : "RAISED";
    const suggest =
      upper > 0 ? "toBeGreaterThanOrEqual" : "toBeLessThanOrEqual";
    violations.push({
      rule: "one-sided-tuned-constant",
      file,
      line,
      symbol: name,
      message:
        `\`${name}\` is declared as a pin on a value owned elsewhere but is only asserted as ${held} bound` +
        ` (${upper > 0 ? [...UPPER_MATCHERS].join("/") : [...LOWER_MATCHERS].join("/")}).` +
        ` The source value can be silently ${missed} and this suite stays green, so it is not a drift guard.` +
        ` Add a bare two-sided assertion — \`.${suggest}(${name})\`, or an exact \`.toBe(${name})\`/\`.toContain(${name})\`.` +
        ` Note \`${name} + 1\` does NOT count: it constrains the neighbouring value, not \`${name}\`.`,
    });
  }
  return violations;
}

/**
 * A comment that says "MUST match `SOME_CONSTANT`" is a hand-copy: the value
 * now lives in two places and nothing links them. Require the file to actually
 * IMPORT the identifier it claims to mirror — importing is the only version of
 * this guard that cannot rot.
 *
 * Scoped to UPPER_SNAKE_CASE identifiers so prose ("must match the shape",
 * "must match `useLiveStatus.ts`") does not fire.
 */
function checkPinCommentImports(
  file: string,
  src: string,
  comments: readonly CommentBlock[],
  optOuts: OptOut[],
): Violation[] {
  const violations: Violation[] = [];
  const importedNames = new Set<string>();
  const importRe = /\bimport\s+(?:type\s+)?\{([^}]*)\}/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(src)) !== null) {
    for (const raw of im[1].split(",")) {
      const name = norm(raw).split(/\s+as\s+/)[0];
      if (name) importedNames.add(name);
    }
  }

  for (const comment of comments) {
    const re = /\bMUST\s+match\s+`([A-Z][A-Z0-9_]{2,})`/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(comment.text)) !== null) {
      const ident = m[1];
      if (importedNames.has(ident)) continue;
      const line = lineOf(src, comment.start + m.index);
      if (isOptedOut(optOuts, "pin-comment-without-import", line)) continue;
      violations.push({
        rule: "pin-comment-without-import",
        file,
        line,
        symbol: ident,
        message:
          `This comment declares the value MUST match \`${ident}\`, but \`${ident}\` is never imported here — the value is hand-copied and will rot silently.` +
          ` Export \`${ident}\` from its owning module and import it, so drift is a compile error instead of a stale literal.`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Opt-out hygiene
// ---------------------------------------------------------------------------

function checkOptOutHygiene(
  file: string,
  optOuts: readonly OptOut[],
): Violation[] {
  return optOuts
    .filter((o) => o.reason.length < MIN_OPT_OUT_REASON_LENGTH)
    .map((o) => ({
      rule: "opt-out-without-reason" as RuleId,
      file,
      line: o.line,
      symbol: o.rule,
      message:
        `\`vacuity-gate-allow: ${o.rule}\` carries no justification (needs at least ${MIN_OPT_OUT_REASON_LENGTH} characters).` +
        ` The escape hatch exists for cases the scanner cannot see — say which one, so the next reader can re-check it.`,
    }));
}

// ---------------------------------------------------------------------------
// Public: scan one test source
// ---------------------------------------------------------------------------

/**
 * Analyze one test file's text. `file` is the repo-relative POSIX path used in
 * messages and as part of the allowlist key.
 */
export function scanTestSource(
  file: string,
  src: string,
  registry: readonly TunedConstantEntry[] = [],
): Violation[] {
  const { masked, comments } = maskAndExtract(src);
  const optOuts = findOptOuts(src, comments);
  return [
    ...checkDegenerateAggregates(file, src, masked, optOuts),
    ...checkOneSidedPins(file, src, masked, comments, optOuts, registry),
    ...checkPinCommentImports(file, src, comments, optOuts),
    ...checkOptOutHygiene(file, optOuts),
  ].sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

// ---------------------------------------------------------------------------
// Rule 3 — duplicated-constant drift
// ---------------------------------------------------------------------------

export interface DuplicatedConstantDecl {
  /** Repo-relative POSIX path of the declaring module. */
  file: string;
  /** Constant name as declared (need not be exported). */
  constant: string;
}

export interface DuplicatedConstantPin {
  /** Why these are knowingly duplicated rather than imported. */
  reason: string;
  declarations: DuplicatedConstantDecl[];
}

/**
 * Evaluate a constant initializer that is a pure arithmetic expression over
 * numeric literals (`5 * 60 * 1000`, `2_000`, `(30 + 15) * 1000`). Returns
 * `null` for anything else — a non-literal initializer means the value is no
 * longer a hand-copied constant and the pin must be re-stated, which the caller
 * reports rather than guessing at.
 */
export function evalNumericLiteralExpr(expr: string): number | null {
  const cleaned = expr.replace(/_/g, "").trim();
  if (!/^[\d.\s*+\-/()]+$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned)) return null;
  // Tokenized shunting-free evaluation via Function is avoided; the grammar is
  // small enough to evaluate with a tiny recursive-descent parser.
  let pos = 0;
  const peek = (): string => {
    while (cleaned[pos] === " ") pos++;
    return cleaned[pos] ?? "";
  };
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c !== "+" && c !== "-") return left;
      pos++;
      const right = parseTerm();
      if (right === null) return null;
      left = c === "+" ? left + right : left - right;
    }
  };
  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c !== "*" && c !== "/") return left;
      pos++;
      const right = parseFactor();
      if (right === null) return null;
      left = c === "*" ? left * right : left / right;
    }
  };
  const parseFactor = (): number | null => {
    const c = peek();
    if (c === "(") {
      pos++;
      const inner = parseExpr();
      if (inner === null || peek() !== ")") return null;
      pos++;
      return inner;
    }
    if (c === "-") {
      pos++;
      const inner = parseFactor();
      return inner === null ? null : -inner;
    }
    const m = /^\d+(?:\.\d+)?/.exec(cleaned.slice(pos));
    if (!m) return null;
    pos += m[0].length;
    return Number(m[0]);
  };
  const value = parseExpr();
  if (value === null) return null;
  return peek() === "" ? value : null;
}

/**
 * Locate `const NAME = <expr>;` in a module and return its value and line.
 * Runs on masked source so a mention inside a comment or string cannot be
 * mistaken for the declaration.
 */
export function readConstantDeclaration(
  src: string,
  constant: string,
): { value: number | null; line: number; raw: string } | null {
  const masked = maskNonCode(src);
  const re = new RegExp(
    `\\b(?:export\\s+)?(?:const|let)\\s+${constant.replace(/\$/g, "\\$")}\\s*(?::[^=;]*)?=\\s*([^;\\n]+)`,
  );
  const m = re.exec(masked);
  if (!m) return null;
  const raw = norm(m[1]);
  return {
    value: evalNumericLiteralExpr(raw),
    line: lineOf(src, m.index),
    raw,
  };
}

/**
 * Assert every knowingly-duplicated constant pair still holds the same value.
 *
 * Fails loudly in THREE ways, all of which matter:
 *   - the values differ (the drift this exists to catch);
 *   - a declaration is MISSING (renamed or deleted) — otherwise a rename would
 *     silently disable the pin, which is the failure mode of every guard this
 *     gate was built to stop;
 *   - an initializer stopped being a numeric literal, so the pin can no longer
 *     compare them and a human has to restate it.
 *
 * `readFile` returns `null` for a path that does not exist.
 */
export function checkDuplicatedConstants(
  pins: readonly DuplicatedConstantPin[],
  readFile: (relPath: string) => string | null,
): Violation[] {
  const violations: Violation[] = [];
  for (const pin of pins) {
    const resolved: Array<{
      decl: DuplicatedConstantDecl;
      value: number;
      line: number;
    }> = [];
    for (const decl of pin.declarations) {
      const src = readFile(decl.file);
      if (src === null) {
        violations.push({
          rule: "duplicated-constant-drift",
          file: decl.file,
          line: 1,
          symbol: decl.constant,
          message:
            `Pinned duplicated constant \`${decl.constant}\` names a file that does not exist.` +
            ` Update showcase/scripts/duplicated-constants.json (the pin must follow the code, or be removed with its sibling). Pin reason: ${pin.reason}`,
        });
        continue;
      }
      const found = readConstantDeclaration(src, decl.constant);
      if (!found) {
        violations.push({
          rule: "duplicated-constant-drift",
          file: decl.file,
          line: 1,
          symbol: decl.constant,
          message:
            `Pinned duplicated constant \`${decl.constant}\` is no longer declared in this file (renamed or removed), so the equality pin against ${pin.declarations
              .filter((d) => d !== decl)
              .map((d) => `\`${d.constant}\``)
              .join(", ")} silently stopped guarding anything.` +
            ` Re-point or delete the entry in showcase/scripts/duplicated-constants.json. Pin reason: ${pin.reason}`,
        });
        continue;
      }
      if (found.value === null) {
        violations.push({
          rule: "duplicated-constant-drift",
          file: decl.file,
          line: found.line,
          symbol: decl.constant,
          message:
            `Pinned duplicated constant \`${decl.constant}\` is initialized to \`${found.raw}\`, which is not an arithmetic expression over numeric literals, so its value cannot be compared with its duplicate.` +
            ` Either import the sibling constant instead of duplicating it, or restate the pin. Pin reason: ${pin.reason}`,
        });
        continue;
      }
      resolved.push({ decl, value: found.value, line: found.line });
    }
    if (resolved.length < 2) continue;
    const [first, ...rest] = resolved;
    for (const other of rest) {
      if (other.value === first.value) continue;
      violations.push({
        rule: "duplicated-constant-drift",
        file: other.decl.file,
        line: other.line,
        symbol: other.decl.constant,
        message:
          `Duplicated-constant DRIFT: \`${other.decl.constant}\` = ${other.value} but \`${first.decl.constant}\` = ${first.value} (${first.decl.file}:${first.line}).` +
          ` These two are declared duplicates of one tuned value and must stay equal. Pin reason: ${pin.reason}`,
      });
    }
  }
  return violations;
}
