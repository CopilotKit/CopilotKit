import { describe, expect, it } from "vitest";
import { calc, evaluateCalc, series } from "../calc";
import { ExpressionError } from "../functions";

describe("calc", () => {
  it("follows operator precedence and parentheses", () => {
    expect(evaluateCalc("1 + 2 * 3", {})).toBe(7);
    expect(evaluateCalc("(1 + 2) * 3", {})).toBe(9);
    expect(evaluateCalc("10 - 4 - 3", {})).toBe(3);
    expect(evaluateCalc("2 * 3 % 4", {})).toBe(2);
    expect(evaluateCalc("-seats * 2", { seats: 3 })).toBe(-6);
  });

  it("reads the args by name and coerces numeric text", () => {
    expect(calc({ expression: "seats * 29", seats: 10 })).toBe(290);
    expect(calc({ expression: "seats * 29", seats: "10" })).toBe(290);
    expect(calc({ expression: "a + b", a: true, b: 1 })).toBe(2);
  });

  it("compares, combines booleans and picks with ?:", () => {
    expect(
      evaluateCalc("seats > 5 && annual", { seats: 10, annual: true }),
    ).toBe(true);
    expect(evaluateCalc("seats >= 10 || false", { seats: 9 })).toBe(false);
    expect(evaluateCalc("plan == 'team'", { plan: "team" })).toBe(true);
    expect(evaluateCalc("plan != 'team'", { plan: "team" })).toBe(false);
    expect(evaluateCalc("seats == '10'", { seats: 10 })).toBe(true);
    expect(evaluateCalc("!annual", { annual: false })).toBe(true);
    expect(
      evaluateCalc("seats * 29 * (annual ? 0.8 : 1)", {
        seats: 10,
        annual: true,
      }),
    ).toBeCloseTo(232);
    expect(
      evaluateCalc("a > b ? 'a' : b > 3 ? 'b' : 'c'", { a: 1, b: 5 }),
    ).toBe("b");
  });

  it("does not evaluate the branch it does not take, so a condition can guard a value", () => {
    expect(evaluateCalc("n == 0 ? 0 : 10 / n", { n: 0 })).toBe(0);
    expect(evaluateCalc("n == 0 ? 0 : 10 / n", { n: 5 })).toBe(2);
    expect(evaluateCalc("n != 0 && 10 / n > 2", { n: 0 })).toBe(false);
    expect(evaluateCalc("n == 0 || 10 / n > 2", { n: 0 })).toBe(true);
    expect(evaluateCalc("has ? missing : 1", { has: false })).toBe(1);
    // A syntax error is still an error, taken or not.
    expect(() => evaluateCalc("n == 0 ? 0 : (10 / n", { n: 0 })).toThrow(
      'expected ")"',
    );
  });

  it("has min, max, round, floor, ceil and abs", () => {
    expect(evaluateCalc("min(seats, 50) + max(1, 2, 3)", { seats: 80 })).toBe(
      53,
    );
    expect(evaluateCalc("round(2.345, 2)", {})).toBe(2.35);
    expect(evaluateCalc("round(2.5)", {})).toBe(3);
    expect(evaluateCalc("floor(2.9) + ceil(2.1) + abs(-1)", {})).toBe(6);
  });

  it("concatenates text with +", () => {
    expect(evaluateCalc("'M' + m", { m: 3 })).toBe("M3");
    expect(evaluateCalc("name + ' x' + 2", { name: "Ada" })).toBe("Ada x2");
  });

  it("refuses what the language does not have", () => {
    expect(() => evaluateCalc("seats * 29", {})).toThrow("unknown name seats");
    expect(() => evaluateCalc("1 / 0", {})).toThrow("division by zero");
    expect(() => evaluateCalc("sin(4)", {})).toThrow("unknown function sin");
    expect(() => evaluateCalc("a.b", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluateCalc("x = 1", { x: 1 })).toThrow(ExpressionError);
    expect(() => evaluateCalc("list * 2", { list: [1] })).toThrow(
      "not a number, text or boolean",
    );
    expect(() => evaluateCalc("'abc' * 2", {})).toThrow("not a number");
    expect(() => evaluateCalc("(1 + 2", {})).toThrow('expected ")"');
    expect(() => evaluateCalc("", {})).toThrow("expression must be a string");
    expect(() => calc({})).toThrow("expression must be a string");
  });
});

describe("calc powers, roots, logs and constants", () => {
  it("computes a monthly loan payment with ^ and pow", () => {
    const scope = { loan: 250000, rate: 6.5, years: 30 };
    const payment = evaluateCalc(
      "loan * (rate / 1200) / (1 - (1 + rate / 1200) ^ -(years * 12))",
      scope,
    ) as number;
    expect(payment).toBeCloseTo(1580.17, 2);
    expect(
      evaluateCalc(
        "loan * (rate / 1200) / (1 - pow(1 + rate / 1200, -(years * 12)))",
        scope,
      ),
    ).toBeCloseTo(payment, 10);
  });

  it("binds ^ tighter than * and unary minus, right to left", () => {
    expect(evaluateCalc("2 * 3 ^ 2", {})).toBe(18);
    expect(evaluateCalc("-2 ^ 2", {})).toBe(-4);
    expect(evaluateCalc("2 ^ 3 ^ 2", {})).toBe(512);
  });

  it("has sqrt, exp, ln, log10, pi and e, and lets an arg shadow a constant", () => {
    expect(evaluateCalc("sqrt(16) + log10(1000)", {})).toBe(7);
    expect(evaluateCalc("ln(exp(2))", {})).toBeCloseTo(2, 12);
    expect(evaluateCalc("round(pi * 100) / 100", {})).toBe(3.14);
    expect(evaluateCalc("e", {})).toBeCloseTo(Math.E, 12);
    expect(evaluateCalc("e * 2", { e: 5 })).toBe(10);
  });

  it("has no ambiguous log, and rejects a wrong number of args", () => {
    expect(() => evaluateCalc("log(1000)", {})).toThrow(/unknown function log/);
    expect(() => evaluateCalc("ln(8, 2)", {})).toThrow(/ln takes 1 argument/);
    expect(() => evaluateCalc("pow(2)", {})).toThrow(/pow takes 2 arguments/);
    expect(() => evaluateCalc("round(1.234, 2, 3)", {})).toThrow(
      /round takes 1 or 2 arguments/,
    );
    expect(evaluateCalc("max(1, 5, 3)", {})).toBe(5);
  });

  it("fails clearly instead of returning NaN or Infinity", () => {
    expect(() => evaluateCalc("sqrt(-1)", {})).toThrow(ExpressionError);
    expect(() => evaluateCalc("ln(0)", {})).toThrow(/no finite result/);
  });
});

describe("series", () => {
  it("builds count items with the loop variable and the other args", () => {
    expect(
      series({
        count: 3,
        variable: "m",
        item: { month: "M${m}", cost: "${m * monthly}" },
        monthly: 290,
      }),
    ).toEqual([
      { month: "M1", cost: 290 },
      { month: "M2", cost: 580 },
      { month: "M3", cost: 870 },
    ]);
  });

  it("defaults to i from 1, takes a start, and keeps literal parts of the item", () => {
    expect(series({ count: 2, item: "${i}" })).toEqual([1, 2]);
    expect(
      series({
        count: 2,
        start: 0,
        item: { n: "${i}", fixed: 7, tags: ["${i * 2}"] },
      }),
    ).toEqual([
      { n: 0, fixed: 7, tags: [0] },
      { n: 1, fixed: 7, tags: [2] },
    ]);
    expect(series({ count: 0, item: "${i}" })).toEqual([]);
  });

  it("refuses a bad count, a bad variable, or no item", () => {
    expect(() => series({ count: 2.5, item: 1 })).toThrow("whole number");
    expect(() => series({ count: 5000, item: 1 })).toThrow("at most 1000");
    expect(() => series({ count: 1, item: 1, variable: "1x" })).toThrow(
      "variable must be a name",
    );
    expect(() => series({ count: 1 })).toThrow("item is required");
  });
});
