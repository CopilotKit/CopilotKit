import { ExpressionError, truthOf } from "./functions";

/**
 * The two CopilotKit value functions that A2UI 1.0 lacks: `calc`, an
 * arithmetic expression over named args, and `series`, a computed list.
 * Both are catalog functions in the sense of the spec: a catalog may
 * declare functions beyond the basic ones, and the model learns them from
 * the schema. The expression language is small and closed: numbers,
 * strings, booleans, the args by name, `+ - * / %`, `^` (power),
 * comparisons, `&& || !`, `cond ? a : b`, parentheses, min, max, round,
 * floor, ceil, abs, pow, sqrt, exp, ln (also log), log10, and the
 * constants pi and e. No property access, no assignment, no code.
 */

type Value = number | string | boolean | null;
export type CalcScope = Readonly<Record<string, unknown>>;

const MAX_SERIES = 1000;

// ---- Lexer ----

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string }
  | { kind: "end" };

const OPERATORS = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "(",
  ")",
  ",",
  "?",
  ":",
  "!",
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+(?:[eE][-+]?\d+)?|^\d+\.?/.exec(source.slice(i));
      if (!match)
        throw new ExpressionError(
          `calc: bad number at "${source.slice(i, i + 8)}"`,
        );
      tokens.push({ kind: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (char === "'" || char === '"') {
      let value = "";
      i++;
      while (i < source.length && source[i] !== char) {
        if (source[i] === "\\" && i + 1 < source.length) i++;
        value += source[i++];
      }
      if (i >= source.length)
        throw new ExpressionError("calc: unclosed string");
      i++;
      tokens.push({ kind: "string", value });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ kind: "name", value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw new ExpressionError(`calc: unexpected "${char}"`);
    tokens.push({ kind: "op", value: op });
    i += op.length;
  }
  tokens.push({ kind: "end" });
  return tokens;
}

// ---- Values ----

function numberOf(value: unknown, what: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new ExpressionError(`calc: ${what} is not finite`);
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value === null || value === undefined) {
    throw new ExpressionError(`calc: ${what} has no value`);
  }
  throw new ExpressionError(`calc: ${what} is not a number`);
}

function describe(value: unknown) {
  return typeof value === "string" ? `"${value}"` : String(value);
}

const MATH: Record<string, (args: number[]) => number> = {
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
  abs: ([x]) => Math.abs(x),
  floor: ([x]) => Math.floor(x),
  ceil: ([x]) => Math.ceil(x),
  round: ([x, decimals = 0]) => {
    const factor = 10 ** Math.trunc(decimals);
    return Math.round(x * factor) / factor;
  },
  pow: ([x, y]) => x ** y,
  sqrt: ([x]) => Math.sqrt(x),
  exp: ([x]) => Math.exp(x),
  ln: ([x]) => Math.log(x),
  log: ([x]) => Math.log(x),
  log10: ([x]) => Math.log10(x),
};

/** Named constants, when no arg of the same name is passed. */
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

// ---- Parser ----

class CalcParser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: CalcScope,
    private readonly source: string,
  ) {}

  parse(): Value {
    const value = this.ternary();
    if (this.tokens[this.pos].kind !== "end") {
      this.fail(`unexpected "${this.text(this.tokens[this.pos])}"`);
    }
    return value;
  }

  private fail(what: string): never {
    throw new ExpressionError(`calc: ${what} in "${this.source}"`);
  }

  private text(token: Token) {
    return token.kind === "end" ? "end" : String(token.value);
  }

  private peekOp(...ops: string[]) {
    const token = this.tokens[this.pos];
    return token.kind === "op" && ops.includes(token.value)
      ? token.value
      : undefined;
  }

  private expectOp(op: string) {
    if (this.peekOp(op) === undefined) {
      this.fail(
        `expected "${op}" but found "${this.text(this.tokens[this.pos])}"`,
      );
    }
    this.pos++;
  }

  /**
   * Parses a part of the expression that the result does not need (the
   * other branch of `?:`, the right side of a decided `&&` or `||`). It
   * still has to be parsed to find where it ends, so syntax errors are
   * reported, but no value is checked or computed: `n == 0 ? 0 : 10 / n`
   * is a valid guard.
   */
  private skipped(parse: () => Value): null {
    this.skipDepth++;
    try {
      parse();
    } finally {
      this.skipDepth--;
    }
    return null;
  }

  /** Above 0 while parsing a part whose value is not needed. */
  private skipDepth = 0;

  /** The number of a value, or 0 while skipping. */
  private num(value: unknown, what: string) {
    return this.skipDepth > 0 ? 0 : numberOf(value, what);
  }

  private ternary(): Value {
    const condition = this.or();
    if (this.peekOp("?") === undefined) return condition;
    this.pos++;
    const takesFirst = truthOf(condition);
    const whenTrue = takesFirst
      ? this.ternary()
      : this.skipped(() => this.ternary());
    this.expectOp(":");
    const whenFalse = takesFirst
      ? this.skipped(() => this.ternary())
      : this.ternary();
    return takesFirst ? whenTrue : whenFalse;
  }

  private or(): Value {
    let left = this.and();
    while (this.peekOp("||")) {
      this.pos++;
      if (truthOf(left)) {
        this.skipped(() => this.and());
        left = true;
      } else {
        left = truthOf(this.and());
      }
    }
    return left;
  }

  private and(): Value {
    let left = this.equality();
    while (this.peekOp("&&")) {
      this.pos++;
      if (!truthOf(left)) {
        this.skipped(() => this.equality());
        left = false;
      } else {
        left = truthOf(this.equality());
      }
    }
    return left;
  }

  private equality(): Value {
    let left = this.comparison();
    for (let op = this.peekOp("==", "!="); op; op = this.peekOp("==", "!=")) {
      this.pos++;
      const right = this.comparison();
      const isEqual =
        typeof left === "number" || typeof right === "number"
          ? this.num(left, "the left side of ==") ===
            this.num(right, "the right side of ==")
          : left === right;
      left = op === "==" ? isEqual : !isEqual;
    }
    return left;
  }

  private comparison(): Value {
    let left = this.additive();
    for (
      let op = this.peekOp("<", "<=", ">", ">=");
      op;
      op = this.peekOp("<", "<=", ">", ">=")
    ) {
      this.pos++;
      const a = this.num(left, `the left side of ${op}`);
      const b = this.num(this.additive(), `the right side of ${op}`);
      left =
        op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
    }
    return left;
  }

  private additive(): Value {
    let left = this.multiplicative();
    for (let op = this.peekOp("+", "-"); op; op = this.peekOp("+", "-")) {
      this.pos++;
      const right = this.multiplicative();
      if (
        op === "+" &&
        (typeof left === "string" || typeof right === "string")
      ) {
        left = `${left ?? ""}${right ?? ""}`;
      } else {
        const a = this.num(left, `the left side of ${op}`);
        const b = this.num(right, `the right side of ${op}`);
        left = op === "+" ? a + b : a - b;
      }
    }
    return left;
  }

  private multiplicative(): Value {
    let left = this.unary();
    for (
      let op = this.peekOp("*", "/", "%");
      op;
      op = this.peekOp("*", "/", "%")
    ) {
      this.pos++;
      const a = this.num(left, `the left side of ${op}`);
      const b = this.num(this.unary(), `the right side of ${op}`);
      if (op !== "*" && b === 0 && this.skipDepth === 0) {
        this.fail("division by zero");
      }
      left = op === "*" ? a * b : op === "/" ? a / b : a % b;
    }
    return left;
  }

  private unary(): Value {
    if (this.peekOp("-")) {
      this.pos++;
      return -this.num(this.unary(), "the operand of -");
    }
    if (this.peekOp("!")) {
      this.pos++;
      return !truthOf(this.unary());
    }
    return this.power();
  }

  /** `a ^ b`: binds tighter than `*` and unary minus, right to left. */
  private power(): Value {
    const base = this.primary();
    if (!this.peekOp("^")) return base;
    this.pos++;
    const exponent = this.unary();
    if (this.skipDepth > 0) return null;
    return this.finite(
      this.num(base, "the left side of ^") **
        this.num(exponent, "the right side of ^"),
      "^",
    );
  }

  private finite(value: number, what: string): number {
    if (!Number.isFinite(value)) this.fail(`${what} has no finite result`);
    return value;
  }

  private primary(): Value {
    const token = this.tokens[this.pos++];
    switch (token.kind) {
      case "number":
        return token.value;
      case "string":
        return token.value;
      case "name":
        return this.name(token.value);
      case "op":
        if (token.value === "(") {
          const value = this.ternary();
          this.expectOp(")");
          return value;
        }
        return this.fail(`unexpected "${token.value}"`);
      case "end":
        return this.fail("missing value");
    }
  }

  private name(name: string): Value {
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "null") return null;
    if (this.peekOp("(")) {
      this.pos++;
      const args: number[] = [];
      if (this.peekOp(")") === undefined) {
        for (;;) {
          args.push(this.num(this.ternary(), `an argument of ${name}`));
          if (this.peekOp(",") === undefined) break;
          this.pos++;
        }
      }
      this.expectOp(")");
      if (this.skipDepth > 0) return null;
      const fn = Object.prototype.hasOwnProperty.call(MATH, name)
        ? MATH[name]
        : undefined;
      if (!fn) this.fail(`unknown function ${name}`);
      if (args.length === 0) this.fail(`${name} needs an argument`);
      return this.finite(fn(args), name);
    }
    if (this.skipDepth > 0) return null;
    if (!Object.prototype.hasOwnProperty.call(this.scope, name)) {
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        return CONSTANTS[name];
      }
      this.fail(`unknown name ${name}; pass it as an arg`);
    }
    const value = this.scope[name];
    if (
      value !== null &&
      typeof value !== "number" &&
      typeof value !== "string" &&
      typeof value !== "boolean"
    ) {
      this.fail(
        `${name} is not a number, text or boolean (${describe(value)})`,
      );
    }
    return value as Value;
  }
}

/**
 * Evaluates `expression` with the names in `scope`. Gives a number, a
 * string, a boolean or null. Throws an {@link ExpressionError} for a bad
 * expression or a missing name.
 */
export function evaluateCalc(expression: unknown, scope: CalcScope): Value {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new ExpressionError("calc: expression must be a string");
  }
  return new CalcParser(tokenize(expression), scope, expression).parse();
}

/** The `calc` function: the expression is `args.expression`, the rest is the scope. */
export function calc(args: Record<string, unknown>): Value {
  const { expression, ...scope } = args;
  return evaluateCalc(expression, scope);
}

const WHOLE_EXPRESSION = /^\$\{([^}]*)\}$/;

/**
 * Fills `item` for one iteration: a string that is one `${...}` gives the
 * typed value of the expression, a string with `${...}` inside it is
 * interpolated as text, and objects and arrays are walked.
 */
function fillItem(item: unknown, scope: CalcScope): unknown {
  if (typeof item === "string") {
    const whole = WHOLE_EXPRESSION.exec(item);
    if (whole) return evaluateCalc(whole[1], scope);
    return item.replace(/\$\{([^}]*)\}/g, (_, expression: string) => {
      const value = evaluateCalc(expression, scope);
      return value === null ? "" : String(value);
    });
  }
  if (Array.isArray(item)) return item.map((entry) => fillItem(entry, scope));
  if (typeof item === "object" && item !== null) {
    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => [key, fillItem(value, scope)]),
    );
  }
  return item;
}

/**
 * The `series` function: `count` copies of `item`, with the loop variable
 * (`variable`, default "i") counting from `start` (default 1) and the other
 * args in scope of the `${...}` expressions of the item.
 */
export function series(args: Record<string, unknown>): unknown[] {
  const { count, item, variable, start, ...scope } = args;
  const length = numberOf(count, "count");
  if (!Number.isInteger(length) || length < 0) {
    throw new ExpressionError("series: count must be a whole number");
  }
  if (length > MAX_SERIES) {
    throw new ExpressionError(`series: count is at most ${MAX_SERIES}`);
  }
  if (item === undefined) throw new ExpressionError("series: item is required");
  const name = variable === undefined ? "i" : variable;
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new ExpressionError("series: variable must be a name");
  }
  const first = start === undefined ? 1 : numberOf(start, "start");
  return Array.from({ length }, (_, index) =>
    fillItem(item, { ...scope, [name]: first + index }),
  );
}
