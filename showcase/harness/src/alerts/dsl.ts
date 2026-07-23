/**
 * Shared DSL primitives used by both alert-engine (runtime dispatch) and
 * rule-loader (load-time validation). Living in its own module so that the
 * loader doesn't have to import from alert-engine, which would otherwise
 * create a type↔value cycle (alert-engine imports `CompiledRule` from
 * rule-loader; rule-loader imports `evalSuppress` from alert-engine).
 *
 * The cycle worked in practice — `CompiledRule` is a `type` import and
 * gets erased — but kept tripping up reviewers and toolchains that scan
 * for cycles (esbuild's dep graph, some ESLint rules). Splitting these
 * into a leaf module eliminates the concern without changing behavior.
 */

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration spec into milliseconds.
 *
 * Accepts either a number (already in ms) or a string like `"15m"` /
 * `"1h"` / `"30s"`. Rejects zero and negative values at parse time — a
 * zero-window rate-limit would either suppress every alert forever
 * (elapsed < windowMs always true) or be meaningless depending on the
 * caller, and both outcomes are bugs we'd rather surface loudly.
 */
export function parseDuration(spec: string | number): number {
  if (typeof spec === "number") {
    if (!Number.isFinite(spec) || spec <= 0) {
      throw new Error(`invalid duration: ${spec} (must be > 0)`);
    }
    return spec;
  }
  const m = spec.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`invalid duration: ${spec}`);
  const [, num, unit] = m;
  const ms = Number(num) * UNIT_MS[unit!]!;
  if (ms <= 0) {
    throw new Error(`invalid duration: ${spec} (must be > 0)`);
  }
  return ms;
}

/**
 * Minimal expression evaluator for YAML `conditions.suppress.when`.
 * Supports: identifiers, string literals ("..." or '...'), number literals,
 * boolean/null, binary ops (==, !=, <=, >=, <, >), logical (&&, ||), unary !,
 * and parenthesized sub-expressions.
 *
 * Rejects any other syntax — in particular no function calls, member access,
 * indexing, or object/array literals — so YAML-authored suppression rules
 * cannot reach arbitrary JS.
 */
export function evalSuppress(
  expr: string,
  vars: Record<string, unknown>,
): boolean {
  try {
    const tokens = tokenizeSuppress(expr);
    const parser = new SuppressParser(tokens, vars);
    const value = parser.parseOr();
    parser.expectEnd();
    return Boolean(value);
  } catch (err) {
    throw new Error(`invalid suppress expression: ${expr} (${String(err)})`);
  }
}

type Tok =
  | { t: "ident"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | {
      t: "op";
      v: "==" | "!=" | "<=" | ">=" | "<" | ">" | "&&" | "||" | "!" | "(" | ")";
    };

function tokenizeSuppress(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) {
          value += src[j + 1];
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      if (src[j] !== quote) throw new Error(`unterminated string at ${i}`);
      out.push({ t: "str", v: value });
      i = j + 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`bad number at ${i}`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === "true") out.push({ t: "bool", v: true });
      else if (word === "false") out.push({ t: "bool", v: false });
      else if (word === "null") out.push({ t: "null" });
      else out.push({ t: "ident", v: word });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "&&" ||
      two === "||"
    ) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (c === "<" || c === ">" || c === "!" || c === "(" || c === ")") {
      out.push({
        t: "op",
        v: c as "<" | ">" | "!" | "(" | ")",
      });
      i++;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(c)} at ${i}`);
  }
  return out;
}

class SuppressParser {
  private pos = 0;
  constructor(
    private readonly tokens: Tok[],
    private readonly vars: Record<string, unknown>,
  ) {}

  private peek(): Tok | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Tok {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error("unexpected end of expression");
    return t;
  }

  expectEnd(): void {
    if (this.pos !== this.tokens.length)
      throw new Error(`unexpected token at pos ${this.pos}`);
  }

  parseOr(): unknown {
    let left = this.parseAnd();
    while (this.matchOp("||")) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  parseAnd(): unknown {
    let left = this.parseEq();
    while (this.matchOp("&&")) {
      const right = this.parseEq();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  parseEq(): unknown {
    let left = this.parseRel();
    while (true) {
      if (this.matchOp("==")) {
        const r = this.parseRel();
        left = left === r;
      } else if (this.matchOp("!=")) {
        const r = this.parseRel();
        left = left !== r;
      } else break;
    }
    return left;
  }

  parseRel(): unknown {
    let left = this.parseUnary();
    while (true) {
      if (this.matchOp("<=")) left = Number(left) <= Number(this.parseUnary());
      else if (this.matchOp(">="))
        left = Number(left) >= Number(this.parseUnary());
      else if (this.matchOp("<"))
        left = Number(left) < Number(this.parseUnary());
      else if (this.matchOp(">"))
        left = Number(left) > Number(this.parseUnary());
      else break;
    }
    return left;
  }

  parseUnary(): unknown {
    if (this.matchOp("!")) return !this.parseUnary();
    return this.parsePrimary();
  }

  parsePrimary(): unknown {
    const t = this.consume();
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    if (t.t === "bool") return t.v;
    if (t.t === "null") return null;
    if (t.t === "ident") {
      // `Object.hasOwn` (not the `in` operator) so identifiers like
      // `toString`, `hasOwnProperty`, `constructor`, `__proto__` do NOT
      // resolve against Object.prototype. Pre-fix a rule typo like
      // `when: "toString"` walked the prototype chain, returned a
      // function reference (truthy), and silently suppressed every alert
      // on every tick.
      if (!Object.hasOwn(this.vars, t.v))
        throw new Error(`unknown identifier: ${t.v}`);
      return this.vars[t.v];
    }
    if (t.t === "op" && t.v === "(") {
      const val = this.parseOr();
      const close = this.consume();
      if (close.t !== "op" || close.v !== ")")
        throw new Error("missing closing paren");
      return val;
    }
    throw new Error(`unexpected token ${JSON.stringify(t)}`);
  }

  private matchOp(op: string): boolean {
    const p = this.peek();
    if (p && p.t === "op" && p.v === op) {
      this.pos++;
      return true;
    }
    return false;
  }
}
