import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  truncateUtf8,
  truncateCsv,
  applyPipeline,
  slackEscape,
} from "./filters.js";

describe("stripAnsi", () => {
  it("removes colour codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m hello")).toBe("red hello");
  });
});

describe("truncateUtf8", () => {
  it("returns input unchanged when within budget", () => {
    expect(truncateUtf8("hello", 200)).toBe("hello");
  });

  it("truncates to exactly N bytes when all ASCII", () => {
    expect(truncateUtf8("abcdefghij", 5)).toBe("abcde");
  });

  it("never splits mid-codepoint (4-byte emoji)", () => {
    // "𝕊" is 4 bytes in UTF-8. Budget 3 should yield "".
    expect(truncateUtf8("𝕊", 3)).toBe("");
    expect(truncateUtf8("𝕊", 4)).toBe("𝕊");
  });

  it("handles mixed content", () => {
    // "café": c(1)+a(1)+f(1)+é(2) = 5 bytes. Budget 4 → "caf".
    expect(truncateUtf8("café", 4)).toBe("caf");
    expect(truncateUtf8("café", 5)).toBe("café");
  });
});

describe("truncateCsv", () => {
  it("joins arrays with ', '", () => {
    expect(truncateCsv(["a", "b", "c"], 50)).toBe("a, b, c");
  });

  it("clips with ellipsis on overflow", () => {
    expect(truncateCsv(["aaa", "bbb", "ccc", "ddd"], 8)).toBe("aaa, ...");
  });

  it("coerces non-array to single-element list", () => {
    expect(truncateCsv("hello", 100)).toBe("hello");
  });

  it("returns '' on null/undefined input (never 'null' / 'undefined')", () => {
    // Regression: previously `String(null)` and `String(undefined)` leaked
    // the literal words into Slack alerts when a template referenced a
    // missing array field.
    expect(truncateCsv(null, 100)).toBe("");
    expect(truncateCsv(undefined, 100)).toBe("");
  });

  it("coerces null/undefined array elements to '' inside the list", () => {
    expect(truncateCsv(["a", null, "c"], 50)).toBe("a, , c");
    expect(truncateCsv([undefined, "b"], 50)).toBe(", b");
  });

  it("clamps suffix when budget is smaller than the ellipsis length", () => {
    // Previously `joined.slice(0, 0) + "..."` emitted 3 chars even
    // though budget was 2 — exceeding the caller's contract. Now the
    // suffix itself is trimmed to fit.
    expect(truncateCsv(["aaa", "bbb"], 2)).toBe("..");
    expect(truncateCsv(["aaa", "bbb"], 1)).toBe(".");
    expect(truncateCsv(["aaa", "bbb"], 0)).toBe("");
    expect(truncateCsv(["aaa", "bbb"], -5)).toBe("");
  });
});

describe("slackEscape", () => {
  it("escapes &, <, >", () => {
    expect(slackEscape("<hi & bye>")).toBe("&lt;hi &amp; bye&gt;");
  });
});

describe("applyPipeline", () => {
  it("runs stripAnsi | truncateUtf8", () => {
    const out = applyPipeline("\u001b[31mhello world\u001b[0m", [
      "stripAnsi",
      "truncateUtf8 5",
    ]);
    expect(out).toBe("hello");
  });

  it("passes through unchanged on unknown filter (graceful degradation)", () => {
    // Previously this threw and killed the entire render. We now pass the
    // value through and log a warning — a degraded alert is always better
    // than a missing alert.
    expect(applyPipeline("hello", ["nope"])).toBe("hello");
  });

  it("chains unknown filter with a subsequent known filter", () => {
    // Passing through unchanged means subsequent stages still get to run.
    expect(applyPipeline("aaaaa", ["nope", "truncateUtf8 3"])).toBe("aaa");
  });

  it("applies default when truncateUtf8 arg is missing", () => {
    // Previously `Number(undefined)` → NaN, then `budget <= 0` returned "".
    // Now we apply a conservative default (2000 bytes) and log a warning.
    const input = "a".repeat(100);
    expect(applyPipeline(input, ["truncateUtf8"])).toBe(input);
  });

  it("applies default when truncateUtf8 arg is NaN", () => {
    // Previously `Number("abc")` → NaN → `NaN <= 0` false → fell through and
    // returned the original string uncapped. Now we apply the default.
    const input = "a".repeat(5000);
    const out = applyPipeline(input, ["truncateUtf8 abc"]);
    expect(out.length).toBeLessThanOrEqual(2000);
  });

  it("applies default when truncateCsv arg is NaN", () => {
    const out = applyPipeline(["a", "b", "c"], ["truncateCsv NaN"]);
    expect(out).toBe("a, b, c");
  });

  it("coerces null/undefined input to '' — never surfaces 'null'/'undefined'", () => {
    // Regression: previously `String(undefined)` at the default branch
    // and final return leaked the literal words into Slack output when
    // the template referenced a missing path.
    expect(applyPipeline(undefined, ["stripAnsi"])).toBe("");
    expect(applyPipeline(null, ["stripAnsi"])).toBe("");
    // Same guarantee when no pipeline is applied.
    expect(applyPipeline(null, [])).toBe("");
  });
});
