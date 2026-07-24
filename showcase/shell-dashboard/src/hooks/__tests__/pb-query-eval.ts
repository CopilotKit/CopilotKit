/**
 * Minimal PocketBase QUERY evaluator for the `useLiveStatus` test doubles.
 *
 * WHY THIS EXISTS. Every fake status endpoint in this directory used to ignore
 * `filter=` and (mostly) `fields=`, answering each request with a slice of one
 * fixture array. That made the suite's wire-shape assertions FIXTURE-LUCK
 * rather than behaviour: a hook that widened its filter to the whole
 * collection, or dropped a needed field from its projection, produced the
 * exact same fake response and the exact same passing test. The initial-fetch
 * paths in `useLiveStatus` are precisely over-fetch-sensitive (a bulk page
 * projection and a supplemental signal fetch whose whole cost model is "how
 * many rows does this filter select"), so the doubles have to actually EVALUATE
 * the query the hook sent.
 *
 * SCOPE. Deliberately not a PocketBase filter implementation — only the
 * grammar `useLiveStatus` emits:
 *
 *   comparison := <ident> ("=" | "!=" | "~" | "!~") <string literal>
 *   term       := comparison | "(" or ")"
 *   and        := term ("&&" term)*
 *   or         := and ("||" and)*
 *
 * That covers every filter the hook can build: the bulk `dimension = {:dim}`
 * scope, and the supplemental union of the comm-error aggregate clause
 * (`dimension = "d6" && key !~ "%/%"`) with the non-green clause
 * (`state != "green"`). Anything outside the grammar THROWS rather than
 * silently evaluating to `true` — a fake that quietly ignores a clause it does
 * not understand is the failure mode this module was written to remove.
 */

type Token =
  | { t: "op"; v: "&&" | "||" | "=" | "!=" | "~" | "!~" }
  | { t: "ident"; v: string }
  | { t: "str"; v: string }
  | { t: "punc"; v: "(" | ")" };

const COMPARISONS = new Set(["=", "!=", "~", "!~"]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: "punc", v: c });
      i += 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "!=" || two === "!~") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (c === "=" || c === "~") {
      out.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\") {
          s += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        s += src[j];
        j += 1;
      }
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (ident) {
      out.push({ t: "ident", v: ident[0] });
      i += ident[0].length;
      continue;
    }
    throw new Error(
      `pb-query-eval: unsupported character ${JSON.stringify(c)} at index ${i} of filter ${JSON.stringify(src)}`,
    );
  }
  return out;
}

/**
 * PocketBase `~` / `!~` are SQL LIKE. A pattern containing an explicit `%` /
 * `_` wildcard is used verbatim (anchored); a pattern with no wildcard is
 * wrapped in implicit `%…%` (substring match), which is what PB does. So
 * `key !~ "%/%"` means "key does not contain a `/`" — the aggregate-key clause.
 */
function like(value: string, pattern: string): boolean {
  const anchored = pattern.includes("%") || pattern.includes("_");
  const body = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, "[\\s\\S]*")
    .replace(/_/g, "[\\s\\S]");
  return new RegExp(
    anchored ? `^${body}$` : `^[\\s\\S]*${body}[\\s\\S]*$`,
  ).test(value);
}

interface Cursor {
  toks: Token[];
  i: number;
}

function peek(c: Cursor): Token | undefined {
  return c.toks[c.i];
}

function parseOr(c: Cursor, row: Record<string, unknown>): boolean {
  let acc = parseAnd(c, row);
  for (;;) {
    const t = peek(c);
    if (t?.t !== "op" || t.v !== "||") return acc;
    c.i += 1;
    // Evaluate BOTH sides (no short-circuit): the grammar is pure, and always
    // consuming the right operand keeps the cursor position independent of the
    // row under test — otherwise a short-circuited `||` would leave unparsed
    // tokens behind and the next row would parse a different expression.
    const rhs = parseAnd(c, row);
    acc = acc || rhs;
  }
}

function parseAnd(c: Cursor, row: Record<string, unknown>): boolean {
  let acc = parseTerm(c, row);
  for (;;) {
    const t = peek(c);
    if (t?.t !== "op" || t.v !== "&&") return acc;
    c.i += 1;
    const rhs = parseTerm(c, row);
    acc = acc && rhs;
  }
}

function parseTerm(c: Cursor, row: Record<string, unknown>): boolean {
  const t = peek(c);
  if (t === undefined) {
    throw new Error("pb-query-eval: unexpected end of filter");
  }
  if (t.t === "punc" && t.v === "(") {
    c.i += 1;
    const v = parseOr(c, row);
    const close = peek(c);
    if (close?.t !== "punc" || close.v !== ")") {
      throw new Error("pb-query-eval: expected `)`");
    }
    c.i += 1;
    return v;
  }
  if (t.t !== "ident") {
    throw new Error(
      `pb-query-eval: expected a field name, got ${JSON.stringify(t)}`,
    );
  }
  const field = t.v;
  c.i += 1;
  const op = peek(c);
  if (op?.t !== "op" || !COMPARISONS.has(op.v)) {
    throw new Error(
      `pb-query-eval: expected a comparison operator after ${field}, got ${JSON.stringify(op)}`,
    );
  }
  c.i += 1;
  const lit = peek(c);
  if (lit?.t !== "str") {
    throw new Error(
      `pb-query-eval: expected a quoted literal after ${field} ${op.v}, got ${JSON.stringify(lit)}`,
    );
  }
  c.i += 1;
  const actual = String(row[field] ?? "");
  switch (op.v) {
    case "=":
      return actual === lit.v;
    case "!=":
      return actual !== lit.v;
    case "~":
      return like(actual, lit.v);
    default:
      return !like(actual, lit.v);
  }
}

/**
 * Does `row` satisfy the PocketBase `filter` expression? An empty/absent
 * filter selects every row (PB semantics).
 */
export function matchesPbFilter(
  filter: string | null | undefined,
  row: Record<string, unknown>,
): boolean {
  if (filter === null || filter === undefined || filter.trim() === "") {
    return true;
  }
  const c: Cursor = { toks: tokenize(filter), i: 0 };
  const v = parseOr(c, row);
  if (c.i !== c.toks.length) {
    throw new Error(
      `pb-query-eval: trailing tokens in filter ${JSON.stringify(filter)}`,
    );
  }
  return v;
}

/**
 * Apply a PocketBase `fields=` projection: keep ONLY the listed keys. An
 * empty/absent projection returns the row unchanged (PB returns every column).
 * This is the half of the contract that made the original cold-load bug
 * invisible to the suite — a double that ignores `fields` hands the hook a
 * `signal` the real server would have omitted.
 */
export function applyPbFields(
  row: Record<string, unknown>,
  fields: string | null | undefined,
): Record<string, unknown> {
  if (fields === null || fields === undefined || fields.trim() === "") {
    return row;
  }
  const keep = new Set(
    fields
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (keep.has(k)) out[k] = v;
  }
  return out;
}

/** Apply a single-field PocketBase `sort=` key (ascending only — all the hook sends). */
export function applyPbSort(
  rows: Record<string, unknown>[],
  sort: string | null | undefined,
): Record<string, unknown>[] {
  if (sort === null || sort === undefined || sort.trim() === "") return rows;
  const key = sort.replace(/^\+/, "");
  return [...rows].sort((a, b) => {
    const av = String(a[key] ?? "");
    const bv = String(b[key] ?? "");
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}
