/**
 * THE PocketBase list-endpoint evaluator for the `useLiveStatus` test doubles.
 *
 * WHY THIS EXISTS. Every fake status endpoint in this tree used to ignore
 * `filter=` and (mostly) `fields=`, answering each request with a slice of one
 * fixture array. That made the suite's wire-shape assertions FIXTURE-LUCK
 * rather than behaviour: a hook that widened its filter to the whole
 * collection, or dropped a needed field from its projection, produced the exact
 * same fake response and the exact same passing test. Worse, because
 * `fetchInitial` APPENDS every supplemental row the bulk pages did not carry, a
 * filter-ignoring supplemental fake silently REPAIRED whatever rows the bulk
 * pagination dropped — which disarmed the #4504 dropped-tail guards outright
 * (mutating the merge to drop an entire short page kept the suite GREEN). The
 * initial-fetch paths are precisely over-fetch- and merge-sensitive, so the
 * doubles have to actually EVALUATE the query the hook sent.
 *
 * WHY THERE IS EXACTLY ONE OF THESE. There used to be THREE divergent copies of
 * this evaluator (this module, a private one inside
 * `useLiveStatus.autocancel.test.tsx`, and a partial one in the
 * supplemental-bounds fakes), disagreeing on quoting, LIKE semantics, numeric
 * ordering and sort direction. Three copies of a fidelity helper is three
 * different definitions of "what PocketBase does", i.e. no definition at all.
 * If you need a behaviour this module lacks, ADD IT HERE. Do not fork it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFORMANCE BASIS — measured, not assumed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every semantic below was verified against a REAL PocketBase v0.22.21 server
 * (the version `showcase/pocketbase/Dockerfile` pins) driven over HTTP with a
 * `status`-shaped collection, and against the real `pocketbase` JS SDK's
 * `filter()`. The earlier copies' docs asserted several of these backwards.
 *
 *  1. WHAT `pb.filter()` EMITS. String params are wrapped in SINGLE quotes with
 *     any embedded `'` escaped as `\'`; numbers, booleans and `null` are
 *     emitted BARE (unquoted). So the hook's `pb.filter("dimension = {:dim}",
 *     {dim: "smoke"})` puts `dimension = 'smoke'` on the wire — NOT the
 *     double-quoted form an earlier revision of this module was written against,
 *     which is why every dimension-scoped test threw here.
 *
 *  2. `~` / `!~` ARE CASE-INSENSITIVE. They compile to SQL `LIKE`, and SQLite's
 *     `LIKE` is ASCII-case-insensitive by default. Verified: `key ~ 'mixedcase'`
 *     selects the row whose `key` is `MIXEDcase`.
 *
 *  3. THE IMPLICIT `%…%` WRAP IS TRIGGERED BY `%` ALONE, AND IT ESCAPES BOTH
 *     WILDCARDS. PocketBase (`tools/search/filter.go`, `wrapLikeParams`) wraps
 *     the pattern in `%…%` only when it contains no UNESCAPED `%`, and that wrap
 *     first escapes `%` AND `_` in the value so they match LITERALLY. `_` does
 *     NOT suppress the wrap. Verified on rows `A_B` / `AZB` / `xxA_Bxx`:
 *       `key ~ 'A_B'`   → ["A_B", "xxA_Bxx"]        (contains a literal "A_B")
 *       `key ~ '%A_B%'` → ["AZB", "A_B", "xxA_Bxx"] (explicit %, `_` is a wildcard)
 *       `key ~ 'AB'`    → ["AB", "xxAB"]            (no wildcard ⇒ contains)
 *     Both prior copies got a different half of this wrong.
 *
 *  4. ORDERING AND EQUALITY FOLLOW THE COLUMN TYPE, NOT THE LITERAL'S FORM.
 *     Verified: `fail_count > 2` selects the rows with `fail_count` 10 and 3 —
 *     a string comparison ("10" < "2") would have dropped the 10.
 *
 *  5. `sort=-key` IS DESCENDING and really reverses the result; `sort=key` and
 *     `sort=+key` ascend. Verified over six rows in both directions.
 *
 *  6. A MALFORMED FILTER IS AN HTTP 400. Verified for an unterminated `'`
 *     literal, an unterminated `"` literal, a dangling operator, an unbalanced
 *     paren, and a reference to a column that does not exist. None of them
 *     degrades to "match everything" — which is exactly the posture this module
 *     takes (see FAIL LOUD).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FAIL LOUD — the contract
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is deliberately NOT a PocketBase implementation. It models the grammar
 * `useLiveStatus` emits:
 *
 *   comparison := <field> ("=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<=")
 *                 <literal>
 *   literal    := "'" … "'" | '"' … '"' | <number> | true | false | null
 *   primary    := comparison | "(" or ")"
 *   and        := primary ("&&" primary)*
 *   or         := and ("||" and)*
 *
 * ANYTHING outside it — an unsupported operator, a bare word (which real
 * PocketBase reads as a COLUMN reference), an unterminated literal, a dangling
 * escape, an unbalanced paren, trailing input, a `sort` key it cannot apply, a
 * non-numeric `page`, a field the row does not carry — THROWS `PbQueryError`.
 * A fake that quietly ignores a clause it does not understand is the exact
 * failure mode this module was written to remove, so "I could not model this"
 * must never be spelled "true".
 *
 * A previous revision claimed this posture and did not hold it: it silently
 * accepted an unterminated string, and `applyPbSort` silently no-opped on a
 * `-key` DESC prefix. Both now throw / apply.
 *
 * SERVING THE CONTRACT OVER HTTP. Throwing from inside a `createServer` handler
 * produces no response at all, so the hook hangs and the test dies on a 20 s
 * `waitFor` timeout with the parse message nowhere in sight. Fakes must
 * therefore go through `evaluatePbList`, which CANNOT throw: it returns either a
 * 200 with the serialized page or a 400 carrying the parse message, mirroring
 * the real server's own 400. Reach for the throwing primitives
 * (`matchesPbFilter` and friends) only outside a request handler.
 */

/** Thrown when a query is malformed, or outside the modelled grammar. */
export class PbQueryError extends Error {
  constructor(message: string) {
    super(`pb-query-eval: ${message}`);
    this.name = "PbQueryError";
  }
}

/** A PocketBase record as the fakes hold it — an unprojected row. */
export type PbRow = Record<string, unknown>;

/** PocketBase clamps `perPage` to 500 server-side, whatever the client asks. */
export const PB_PER_PAGE_CLAMP = 500;

// ---------------------------------------------------------------------------
// Filter: lexing + parsing (once per filter STRING) …
// ---------------------------------------------------------------------------

/** Longest-first, so `!=` is never mis-read as `!` followed by `=`. */
const PB_OPERATORS = ["!=", ">=", "<=", "!~", "=", "~", ">", "<"] as const;
type PbOperator = (typeof PB_OPERATORS)[number];

/**
 * A parsed right-hand literal. `quoted` records the SOURCE form: it is how we
 * tell `dimension = 'smoke'` (a string) from `dimension = smoke` (a column
 * reference real PocketBase 400s on, and that we must not silently read as the
 * string "smoke").
 */
interface PbLiteral {
  text: string;
  quoted: boolean;
  isNull: boolean;
}

type PbFilterNode =
  | { kind: "or"; left: PbFilterNode; right: PbFilterNode }
  | { kind: "and"; left: PbFilterNode; right: PbFilterNode }
  | { kind: "cmp"; field: string; op: PbOperator; literal: PbLiteral };

interface Cursor {
  src: string;
  at: number;
}

function skipWs(c: Cursor): void {
  while (c.at < c.src.length && /\s/.test(c.src[c.at]!)) c.at += 1;
}

function readIdentifier(c: Cursor): string {
  skipWs(c);
  const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(c.src.slice(c.at));
  if (m === null) {
    throw new PbQueryError(
      `expected a field name at offset ${c.at} of filter ${JSON.stringify(c.src)}`,
    );
  }
  c.at += m[0].length;
  return m[0];
}

function readOperator(c: Cursor): PbOperator {
  skipWs(c);
  for (const op of PB_OPERATORS) {
    if (c.src.startsWith(op, c.at)) {
      c.at += op.length;
      return op;
    }
  }
  throw new PbQueryError(
    `expected one of ${PB_OPERATORS.join(" ")} at offset ${c.at} of filter ` +
      `${JSON.stringify(c.src)} (PocketBase's "any-of" operators — ?=, ?!=, ?~ … — ` +
      `are not modelled)`,
  );
}

/**
 * Reads a literal in either quoting form, or a bare number/boolean/null.
 *
 * A bare WORD is rejected rather than read as a string: real PocketBase treats
 * an unquoted word as a column reference and answers 400 when no such column
 * exists (verified), so accepting it here would invent a semantic the server
 * does not have.
 */
function readLiteral(c: Cursor): PbLiteral {
  skipWs(c);
  const quote = c.src[c.at];
  if (quote === "'" || quote === '"') {
    c.at += 1;
    let out = "";
    let closed = false;
    while (c.at < c.src.length) {
      const ch = c.src[c.at]!;
      if (ch === "\\") {
        // `pb.filter()` escapes an embedded `'` as `\'`; take the next
        // character literally, and refuse a backslash with nothing after it.
        const next = c.src[c.at + 1];
        if (next === undefined) {
          throw new PbQueryError(
            `dangling escape at offset ${c.at} of filter ${JSON.stringify(c.src)}`,
          );
        }
        out += next;
        c.at += 2;
        continue;
      }
      if (ch === quote) {
        closed = true;
        c.at += 1;
        break;
      }
      out += ch;
      c.at += 1;
    }
    if (!closed) {
      throw new PbQueryError(
        `unterminated ${quote === "'" ? "single" : "double"}-quoted literal in ` +
          `filter ${JSON.stringify(c.src)}`,
      );
    }
    return { text: out, quoted: true, isNull: false };
  }

  let raw = "";
  while (c.at < c.src.length && /[^\s()&|=!~<>]/.test(c.src[c.at]!)) {
    raw += c.src[c.at];
    c.at += 1;
  }
  if (raw === "") {
    throw new PbQueryError(
      `expected a literal at offset ${c.at} of filter ${JSON.stringify(c.src)}`,
    );
  }
  if (raw === "null") return { text: "", quoted: false, isNull: true };
  if (raw === "true" || raw === "false") {
    return { text: raw, quoted: false, isNull: false };
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
    return { text: raw, quoted: false, isNull: false };
  }
  throw new PbQueryError(
    `bare literal ${JSON.stringify(raw)} in filter ${JSON.stringify(c.src)} is ` +
      `not a number, boolean or null — real PocketBase reads an unquoted word as ` +
      `a COLUMN reference (and 400s when the column is unknown), which this ` +
      `evaluator does not model. Quote it: pb.filter() emits single quotes.`,
  );
}

function parsePrimary(c: Cursor): PbFilterNode {
  skipWs(c);
  if (c.src[c.at] === "(") {
    c.at += 1;
    const inner = parseOr(c);
    skipWs(c);
    if (c.src[c.at] !== ")") {
      throw new PbQueryError(
        `unbalanced parenthesis at offset ${c.at} of filter ${JSON.stringify(c.src)}`,
      );
    }
    c.at += 1;
    return inner;
  }
  const field = readIdentifier(c);
  const op = readOperator(c);
  const literal = readLiteral(c);
  return { kind: "cmp", field, op, literal };
}

function parseAnd(c: Cursor): PbFilterNode {
  let node = parsePrimary(c);
  for (;;) {
    skipWs(c);
    if (!c.src.startsWith("&&", c.at)) return node;
    c.at += 2;
    node = { kind: "and", left: node, right: parsePrimary(c) };
  }
}

function parseOr(c: Cursor): PbFilterNode {
  let node = parseAnd(c);
  for (;;) {
    skipWs(c);
    if (!c.src.startsWith("||", c.at)) return node;
    c.at += 2;
    node = { kind: "or", left: node, right: parseAnd(c) };
  }
}

/**
 * Filters are parsed to an AST ONCE and cached by source string, then evaluated
 * per row. Parsing and evaluating in a single pass (what both prior copies did)
 * forces every branch to be evaluated even when short-circuiting would do —
 * otherwise the shared cursor desynchronizes between rows — and re-lexes the
 * filter for every one of the tens of thousands of rows the page-cap fakes
 * serve. Separating the phases removes both problems.
 */
const parsedFilters = new Map<string, PbFilterNode>();

function parseFilter(src: string): PbFilterNode {
  const cached = parsedFilters.get(src);
  if (cached !== undefined) return cached;
  const c: Cursor = { src, at: 0 };
  const node = parseOr(c);
  skipWs(c);
  if (c.at !== src.length) {
    throw new PbQueryError(
      `trailing input at offset ${c.at} of filter ${JSON.stringify(src)}`,
    );
  }
  parsedFilters.set(src, node);
  return node;
}

// ---------------------------------------------------------------------------
// … and evaluating (once per ROW)
// ---------------------------------------------------------------------------

function escapeRegexChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function containsUnescaped(s: string, target: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\") {
      i += 1;
      continue;
    }
    if (s[i] === target) return true;
  }
  return false;
}

function escapeLikeWildcards(s: string): string {
  let out = "";
  for (const ch of s) out += ch === "%" || ch === "_" ? `\\${ch}` : ch;
  return out;
}

/**
 * Compiles a PocketBase LIKE pattern. See CONFORMANCE BASIS items 2 and 3: the
 * `%…%` wrap fires only when the pattern has no unescaped `%`, and that wrap
 * escapes `%`/`_` so they match literally; the result is case-insensitive.
 */
function likeRegex(pattern: string): RegExp {
  const effective = containsUnescaped(pattern, "%")
    ? pattern
    : `%${escapeLikeWildcards(pattern)}%`;
  let rx = "";
  for (let i = 0; i < effective.length; i += 1) {
    const ch = effective[i]!;
    if (ch === "\\") {
      const next = effective[i + 1];
      if (next === undefined) {
        rx += "\\\\";
        continue;
      }
      rx += escapeRegexChar(next);
      i += 1;
      continue;
    }
    if (ch === "%") {
      rx += "[\\s\\S]*";
      continue;
    }
    if (ch === "_") {
      rx += "[\\s\\S]";
      continue;
    }
    rx += escapeRegexChar(ch);
  }
  // `i`: SQLite's LIKE — which PocketBase's `~` compiles to — is
  // ASCII-case-insensitive by default.
  return new RegExp(`^${rx}$`, "i");
}

const likePatterns = new Map<string, RegExp>();

function cachedLikeRegex(pattern: string): RegExp {
  const hit = likePatterns.get(pattern);
  if (hit !== undefined) return hit;
  const rx = likeRegex(pattern);
  likePatterns.set(pattern, rx);
  return rx;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function orderedCompare(op: PbOperator, cmp: number): boolean {
  switch (op) {
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    default:
      return cmp <= 0;
  }
}

function evalComparison(
  node: Extract<PbFilterNode, { kind: "cmp" }>,
  row: PbRow,
  src: string,
): boolean {
  const { field, op, literal } = node;
  if (!(field in row)) {
    throw new PbQueryError(
      `filter ${JSON.stringify(src)} references field ${JSON.stringify(field)}, ` +
        `which this row does not carry (${JSON.stringify(Object.keys(row))}). Real ` +
        `PocketBase answers an unknown-column filter with HTTP 400, so the fake ` +
        `must not read it as empty — fix the fixture or the filter.`,
    );
  }
  const value = row[field];

  if (op === "~" || op === "!~") {
    if (literal.isNull) {
      throw new PbQueryError(
        `LIKE against a null literal in filter ${JSON.stringify(src)} is not modelled`,
      );
    }
    const hit = cachedLikeRegex(literal.text).test(textOf(value));
    return op === "~" ? hit : !hit;
  }

  if (literal.isNull) {
    // PocketBase compares against SQL NULL, and its text columns store the
    // zero value, so an absent/null field and `""` are both null-ish.
    const nullish = value === null || value === undefined || value === "";
    if (op === "=") return nullish;
    if (op === "!=") return !nullish;
    throw new PbQueryError(
      `ordering operator ${op} against a null literal in filter ` +
        `${JSON.stringify(src)} is not modelled`,
    );
  }

  // CONFORMANCE BASIS item 4: a numeric column compares NUMERICALLY, whichever
  // form the literal took on the wire.
  if (typeof value === "number") {
    const rhs = Number(literal.text);
    if (!Number.isFinite(rhs)) {
      throw new PbQueryError(
        `cannot compare numeric field ${JSON.stringify(field)} against ` +
          `non-numeric literal ${JSON.stringify(literal.text)} in filter ` +
          `${JSON.stringify(src)}`,
      );
    }
    if (op === "=") return value === rhs;
    if (op === "!=") return value !== rhs;
    return orderedCompare(op, value < rhs ? -1 : value > rhs ? 1 : 0);
  }

  // Everything else compares as text. Ordering therefore uses JS's UTF-16 code
  // unit order rather than SQLite's BINARY collation; they agree over the ASCII
  // keys/ids/timestamps these fakes carry, and the hook only ever emits `=`,
  // `!=` and LIKE on text columns anyway.
  const lhs = textOf(value);
  if (op === "=") return lhs === literal.text;
  if (op === "!=") return lhs !== literal.text;
  return orderedCompare(
    op,
    lhs < literal.text ? -1 : lhs > literal.text ? 1 : 0,
  );
}

function evalNode(node: PbFilterNode, row: PbRow, src: string): boolean {
  switch (node.kind) {
    case "or":
      return evalNode(node.left, row, src) || evalNode(node.right, row, src);
    case "and":
      return evalNode(node.left, row, src) && evalNode(node.right, row, src);
    default:
      return evalComparison(node, row, src);
  }
}

/**
 * Does `row` satisfy the PocketBase `filter` expression? An absent or empty
 * filter selects every row, which is PocketBase's own behaviour.
 *
 * THROWS `PbQueryError` on anything outside the modelled grammar — see FAIL
 * LOUD in the module header. Inside an HTTP handler use `evaluatePbList`, which
 * turns that throw into the 400 the real server would have sent.
 */
export function matchesPbFilter(
  filter: string | null | undefined,
  row: PbRow,
): boolean {
  if (filter === null || filter === undefined || filter.trim() === "") {
    return true;
  }
  return evalNode(parseFilter(filter), row, filter);
}

// ---------------------------------------------------------------------------
// Projection and ordering
// ---------------------------------------------------------------------------

/**
 * Applies a PocketBase `fields=` projection: keep ONLY the listed keys. An
 * absent or empty projection returns the row unchanged (PB returns every
 * column). This is the half of the contract that made the cold-load `signal`
 * bug invisible to the suite — a double that ignores `fields` hands the hook a
 * `signal` the real server would have omitted.
 */
export function applyPbFields(
  row: PbRow,
  fields: string | null | undefined,
): PbRow {
  if (fields === null || fields === undefined || fields.trim() === "") {
    return row;
  }
  const keep = fields
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  if (keep.length === 0) {
    throw new PbQueryError(
      `fields projection ${JSON.stringify(fields)} names no usable field`,
    );
  }
  const out: PbRow = {};
  for (const key of keep) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const at = textOf(a);
  const bt = textOf(b);
  return at < bt ? -1 : at > bt ? 1 : 0;
}

/**
 * Applies a PocketBase `sort=`: a comma-separated key list, each key optionally
 * prefixed `-` (DESC) or `+` (explicit ASC). Verified against the real server
 * in both directions.
 *
 * A previous revision stripped a leading `+` and SILENTLY IGNORED a leading
 * `-`, so a DESC sort was served ascending and no test could see it. Anything
 * this cannot apply — an empty key, one of PocketBase's `@`-macros like
 * `@random` — now throws instead.
 */
export function applyPbSort(
  rows: readonly PbRow[],
  sort: string | null | undefined,
): PbRow[] {
  if (sort === null || sort === undefined || sort.trim() === "") {
    return [...rows];
  }
  const keys = sort
    .split(",")
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      if (raw.startsWith("@")) {
        throw new PbQueryError(
          `sort key ${JSON.stringify(raw)} is a PocketBase macro this evaluator ` +
            `cannot model deterministically (filter ${JSON.stringify(sort)})`,
        );
      }
      const desc = raw.startsWith("-");
      const key = desc || raw.startsWith("+") ? raw.slice(1) : raw;
      if (key === "") {
        throw new PbQueryError(`empty sort key in ${JSON.stringify(sort)}`);
      }
      return { key, desc };
    });
  if (keys.length === 0) {
    throw new PbQueryError(`sort ${JSON.stringify(sort)} names no usable key`);
  }
  return [...rows].sort((a, b) => {
    for (const { key, desc } of keys) {
      const cmp = compareValues(a[key], b[key]);
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// The list endpoint itself
// ---------------------------------------------------------------------------

/** The parsed shape of a PocketBase `getList` request's query string. */
export interface PbListRequest {
  page: number;
  perPage: number;
  /** `null` when the client sent no filter ⇒ match every row. */
  filter: string | null;
  /** `null` when the client sent no projection ⇒ return full rows. */
  fields: string | null;
  sort: string | null;
  skipTotal: boolean;
}

/** An absent OR empty query param means "not sent". */
function blankToNull(v: string | null): string | null {
  return v === null || v === "" ? null : v;
}

function readPositiveInt(
  raw: string | null,
  fallback: number,
  what: string,
): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    // A non-numeric `page` used to coerce to NaN and yield a silently EMPTY
    // (i.e. short) page, which reads to the hook as "end of collection".
    throw new PbQueryError(
      `${what}=${JSON.stringify(raw)} is not a positive integer`,
    );
  }
  return n;
}

/**
 * Parses a list request off the URL. `perPage` is clamped the way real
 * PocketBase clamps it server-side, regardless of what the client asked for.
 */
export function readPbListRequest(
  url: URL,
  opts: { perPageClamp?: number } = {},
): PbListRequest {
  const clamp = opts.perPageClamp ?? PB_PER_PAGE_CLAMP;
  const q = url.searchParams;
  const skipTotal = q.get("skipTotal");
  return {
    page: readPositiveInt(q.get("page"), 1, "page"),
    perPage: Math.min(
      readPositiveInt(q.get("perPage"), clamp, "perPage"),
      clamp,
    ),
    filter: blankToNull(q.get("filter")),
    fields: blankToNull(q.get("fields")),
    sort: blankToNull(q.get("sort")),
    skipTotal: skipTotal === "1" || skipTotal === "true",
  };
}

/** Which of the hook's three list callers issued this request? */
export type PbListCaller = "heartbeat" | "supplemental" | "bulk";

/**
 * Classifies a request by the ONE property that structurally separates the
 * hook's three list callers, so the fakes' instrumentation can never conflate
 * them:
 *
 *  - the heartbeat ping is the only `perPage: 1` request;
 *  - the SUPPLEMENTAL signal fetch is the only one that asks for `signal` —
 *    bringing the heavy blob back is its entire purpose, and the bulk fetch
 *    always projects it AWAY (`STATUS_LIST_FIELDS`). A projection-LESS request
 *    is also supplemental: that was its pre-fix shape, and the bulk fetch has
 *    always carried a projection, so keying on it lets the same assertions run
 *    red and green across the change.
 *
 * Discriminating on a filter substring instead would be unreliable — the
 * supplemental filter is a UNION whose comm-error clause is DROPPED for a
 * dimension scope outside `FLEET_COMM_AGGREGATE_DIMENSIONS`.
 */
export function classifyPbListRequest(req: PbListRequest): PbListCaller {
  if (req.perPage === 1) return "heartbeat";
  if (req.fields === null) return "supplemental";
  return req.fields.split(",").includes("signal") ? "supplemental" : "bulk";
}

/**
 * Serializes a PocketBase list response body: `fields`-projected items, and the
 * COUNT(*) envelope (`totalItems`/`totalPages`) ONLY when the client did not
 * ask to skip it. Honouring `skipTotal` is what forces the hook to paginate by
 * `items.length` rather than by a `totalPages` it can no longer see.
 */
export function pbListBody(
  items: readonly PbRow[],
  req: PbListRequest,
  matchedTotal: number,
): string {
  const projected = items.map((row) => applyPbFields(row, req.fields));
  if (req.skipTotal) {
    return JSON.stringify({
      page: req.page,
      perPage: req.perPage,
      items: projected,
    });
  }
  return JSON.stringify({
    page: req.page,
    perPage: req.perPage,
    totalItems: matchedTotal,
    totalPages: Math.max(1, Math.ceil(matchedTotal / req.perPage)),
    items: projected,
  });
}

/** What the real server does, in order: filter, then sort. */
export function pbSelectRows(
  dataset: readonly PbRow[],
  req: PbListRequest,
): PbRow[] {
  // Parse the filter even when there is nothing to match it against. Otherwise
  // a leg that legitimately serves an EMPTY page (the supplemental leg of the
  // runaway-BULK fake, say) would answer 200 for a filter the real server would
  // have rejected — a silent pass on the one query nobody looked at.
  if (req.filter !== null && req.filter.trim() !== "") {
    parseFilter(req.filter);
  }
  const matched = dataset.filter((row) => matchesPbFilter(req.filter, row));
  return req.sort === null ? matched : applyPbSort(matched, req.sort);
}

/** …then the page slice. */
export function pbPageSlice(
  ordered: readonly PbRow[],
  req: PbListRequest,
): PbRow[] {
  const start = (req.page - 1) * req.perPage;
  return ordered.slice(start, start + req.perPage);
}

/**
 * The outcome of answering one list request. There is no third case and no
 * throw: see `evaluatePbList`.
 */
export type PbListOutcome =
  | { status: 200; body: string; items: PbRow[] }
  | { status: 400; body: string; items?: undefined };

/**
 * Answers one list request against `dataset`, the way real PocketBase does:
 * filter → sort → page slice → `fields` projection → `skipTotal` envelope.
 *
 * THIS FUNCTION NEVER THROWS. A malformed or unmodelled query comes back as a
 * 400 whose body carries the parse message — which is what the real server
 * does, and which is the whole reason to call this instead of the primitives.
 * Throwing out of a `createServer` handler sends NO response at all: the hook
 * hangs, the test dies on a 20 s `waitFor` timeout, and the parse message the
 * fail-loud contract exists to deliver is never seen. Routing every fake
 * through here makes that impossible to get wrong by omission.
 *
 * `alreadyPaged` is for the fakes that SYNTHESIZE one page at a time (the
 * page-cap servers, whose point is an unbounded page stream that no fixture
 * array could hold): `dataset` is then the caller's page rather than the whole
 * collection, so the slice is skipped — but `filter`, `sort`, `fields` and
 * `skipTotal` are still applied, so those fakes cannot silently match
 * everything either.
 */
export function evaluatePbList(
  dataset: readonly PbRow[],
  req: PbListRequest,
  opts: { alreadyPaged?: boolean } = {},
): PbListOutcome {
  try {
    const ordered = pbSelectRows(dataset, req);
    const items =
      opts.alreadyPaged === true ? ordered : pbPageSlice(ordered, req);
    return {
      status: 200,
      body: pbListBody(items, req, ordered.length),
      items,
    };
  } catch (err) {
    return {
      status: 400,
      body: JSON.stringify({
        code: 400,
        message: err instanceof Error ? err.message : String(err),
        data: {},
      }),
    };
  }
}
