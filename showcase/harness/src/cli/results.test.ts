import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { printSummary, type TerminalResult } from "./results.js";

// ---------------------------------------------------------------------------
// Capture console.log output so we can assert on the rendered summary. Strip
// ANSI escapes to keep assertions readable.
// ---------------------------------------------------------------------------
const ANSI = /\x1b\[[0-9;]*m/g;

function captureSummary(results: TerminalResult[]): string {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  try {
    printSummary(results);
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n").replace(ANSI, "");
}

const r = (
  key: string,
  state: TerminalResult["state"],
  error?: string,
): TerminalResult => ({ key, state, durationMs: 1000, error });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("printSummary", () => {
  it("counts unknown as neutral no-evidence, not a failure", () => {
    const out = captureSummary([
      r("a", "green"),
      r("b", "unknown", "no evidence"),
      r("c", "red", "boom"),
    ]);

    // green = passed, red = failed, unknown = neither.
    expect(out).toContain("1 passed");
    expect(out).toContain("1 failed");
    expect(out).not.toContain("2 failed");
    // unknown surfaced under a distinct neutral line.
    expect(out).toContain("1 no evidence");
  });

  it("does not list unknown under the Failed: header", () => {
    const out = captureSummary([
      r("a", "green"),
      r("b", "unknown", "no evidence"),
      r("c", "red", "boom"),
    ]);

    const failedIdx = out.indexOf("Failed:");
    expect(failedIdx).toBeGreaterThan(-1);
    const failedSection = out.slice(failedIdx);
    // The red probe is listed under Failed:, the unknown one is not.
    expect(failedSection).toContain("c:");
    expect(failedSection).not.toContain("b:");
  });

  it("treats degraded and error as failures", () => {
    const out = captureSummary([
      r("a", "green"),
      r("b", "degraded"),
      r("c", "error", "probe error"),
    ]);

    expect(out).toContain("1 passed");
    expect(out).toContain("2 failed");
  });

  it("reports all-green with no failure or no-evidence lines", () => {
    const out = captureSummary([r("a", "green"), r("b", "green")]);

    expect(out).toContain("2 passed");
    expect(out).not.toContain("failed");
    expect(out).not.toContain("Failed:");
    expect(out).not.toContain("no evidence");
  });

  it("surfaces no-evidence even when there are zero hard failures", () => {
    const out = captureSummary([r("a", "green"), r("b", "unknown")]);

    expect(out).toContain("1 passed");
    expect(out).not.toContain("1 failed");
    expect(out).toContain("1 no evidence");
  });
});
