import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  transformHarnessResponse,
  loadBaseline,
  saveBaseline,
  captureBaseline,
  type EvalBaseline,
} from "./baseline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "baseline-test-"));
}

// ---------------------------------------------------------------------------
// transformHarnessResponse
// ---------------------------------------------------------------------------

describe("transformHarnessResponse", () => {
  it("converts API probe list with services to slug-keyed baseline format", () => {
    const response = {
      probes: [
        {
          id: "e2e-deep",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:05:00.000Z",
            durationMs: 300_000,
            state: "completed" as const,
            summary: {
              total: 10,
              passed: 8,
              failed: 2,
              services: [
                {
                  slug: "e2e-deep:showcase-mastra",
                  result: "green",
                  state: "completed",
                },
                {
                  slug: "e2e-deep:showcase-langgraph-python",
                  result: "red",
                  state: "completed",
                },
              ],
            },
          },
        },
        {
          id: "smoke-quick",
          kind: "smoke",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: {
              total: 5,
              passed: 5,
              failed: 0,
              services: [
                {
                  slug: "smoke-quick:showcase-built-in-agent",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    expect(baseline.version).toBe(1);
    expect(baseline.source).toBe("harness-prod");
    expect(baseline.timestamp).toBeTruthy();

    // Results keyed by integration slug with _status sub-key
    expect(baseline.results["mastra"]).toBeDefined();
    expect(baseline.results["mastra"]["_status"]).toEqual({
      status: "pass",
    });
    expect(baseline.results["langgraph-python"]).toBeDefined();
    expect(baseline.results["langgraph-python"]["_status"]).toEqual({
      status: "fail",
    });
    expect(baseline.results["built-in-agent"]).toBeDefined();
    expect(baseline.results["built-in-agent"]["_status"]).toEqual({
      status: "pass",
    });

    // No probe-keyed results
    expect(baseline.results["e2e-deep"]).toBeUndefined();
    expect(baseline.results["smoke-quick"]).toBeUndefined();

    expect(baseline.summary).toEqual({
      total: 3,
      pass: 2,
      fail: 1,
      skip: 0,
    });
  });

  it("skips probes with null lastRun", () => {
    const response = {
      probes: [
        {
          id: "never-ran",
          kind: "e2e",
          lastRun: null,
        },
        {
          id: "did-run",
          kind: "smoke",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: {
              total: 3,
              passed: 3,
              failed: 0,
              services: [
                {
                  slug: "did-run:showcase-mastra",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    expect(baseline.results["mastra"]).toBeDefined();
    expect(baseline.results["mastra"]["_status"]).toEqual({
      status: "pass",
    });
    expect(baseline.summary.total).toBe(1);
    expect(baseline.summary.skip).toBe(0);
  });

  it("skips probes with null summary", () => {
    const response = {
      probes: [
        {
          id: "no-summary",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: null,
          },
        },
        {
          id: "has-summary",
          kind: "smoke",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: {
              total: 2,
              passed: 2,
              failed: 0,
              services: [
                {
                  slug: "has-summary:showcase-agno",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    expect(baseline.results["agno"]).toBeDefined();
    expect(baseline.results["agno"]["_status"]).toEqual({
      status: "pass",
    });
    expect(baseline.summary.total).toBe(1);
  });

  it("skips probes without services array gracefully", () => {
    const response = {
      probes: [
        {
          id: "legacy-probe",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:05:00.000Z",
            durationMs: 300_000,
            state: "completed" as const,
            summary: {
              total: 10,
              passed: 8,
              failed: 2,
              // no services array
            },
          },
        },
        {
          id: "new-probe",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:05:00.000Z",
            durationMs: 300_000,
            state: "completed" as const,
            summary: {
              total: 5,
              passed: 5,
              failed: 0,
              services: [
                {
                  slug: "new-probe:showcase-crewai-crews",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    // legacy-probe has no services — should be skipped entirely
    expect(baseline.results["legacy-probe"]).toBeUndefined();
    // new-probe's services should be captured
    expect(baseline.results["crewai-crews"]).toBeDefined();
    expect(baseline.results["crewai-crews"]["_status"]).toEqual({
      status: "pass",
    });
    expect(baseline.summary).toEqual({
      total: 1,
      pass: 1,
      fail: 0,
      skip: 0,
    });
  });

  it("keeps worst status when same slug appears in multiple probes", () => {
    const response = {
      probes: [
        {
          id: "e2e-deep",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:05:00.000Z",
            durationMs: 300_000,
            state: "completed" as const,
            summary: {
              total: 5,
              passed: 5,
              failed: 0,
              services: [
                {
                  slug: "e2e-deep:showcase-mastra",
                  result: "green",
                  state: "completed",
                },
                {
                  slug: "e2e-deep:showcase-langgraph-python",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
        {
          id: "e2e-demos",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:03:00.000Z",
            durationMs: 180_000,
            state: "completed" as const,
            summary: {
              total: 5,
              passed: 3,
              failed: 2,
              services: [
                {
                  slug: "e2e-demos:showcase-mastra",
                  result: "red",
                  state: "completed",
                },
                {
                  slug: "e2e-demos:showcase-langgraph-python",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    // mastra: green in e2e-deep, red in e2e-demos -> worst = fail
    expect(baseline.results["mastra"]["_status"]).toEqual({
      status: "fail",
    });
    // langgraph-python: green in both -> pass
    expect(baseline.results["langgraph-python"]["_status"]).toEqual({
      status: "pass",
    });

    expect(baseline.summary).toEqual({
      total: 2,
      pass: 1,
      fail: 1,
      skip: 0,
    });
  });

  it("skips service slugs that do not contain :showcase- separator", () => {
    const response = {
      probes: [
        {
          id: "custom-probe",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:05:00.000Z",
            durationMs: 300_000,
            state: "completed" as const,
            summary: {
              total: 3,
              passed: 3,
              failed: 0,
              services: [
                {
                  slug: "malformed-slug-no-separator",
                  result: "green",
                  state: "completed",
                },
                {
                  slug: "custom-probe:showcase-mastra",
                  result: "green",
                  state: "completed",
                },
              ],
            },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    // Malformed slug should be skipped
    expect(Object.keys(baseline.results)).toEqual(["mastra"]);
    expect(baseline.summary.total).toBe(1);
  });

  it("returns empty results for response with no probes", () => {
    const response = { probes: [] };
    const baseline = transformHarnessResponse(response);

    expect(baseline.results).toEqual({});
    expect(baseline.summary).toEqual({
      total: 0,
      pass: 0,
      fail: 0,
      skip: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// loadBaseline
// ---------------------------------------------------------------------------

describe("loadBaseline", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    const result = loadBaseline(path.join(dir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("reads valid JSON from disk", () => {
    const baseline: EvalBaseline = {
      version: 1,
      timestamp: "2025-06-01T00:00:00.000Z",
      source: "harness-prod",
      branch: "",
      base: "",
      level: "deep",
      results: {
        mastra: {
          _status: { status: "pass" },
        },
      },
      summary: { total: 1, pass: 1, fail: 0, skip: 0 },
    };
    const filePath = path.join(dir, "baseline.json");
    fs.writeFileSync(filePath, JSON.stringify(baseline));

    const loaded = loadBaseline(filePath);
    expect(loaded).toEqual(baseline);
  });
});

// ---------------------------------------------------------------------------
// saveBaseline
// ---------------------------------------------------------------------------

describe("saveBaseline", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes valid JSON to disk", () => {
    const baseline: EvalBaseline = {
      version: 1,
      timestamp: "2025-06-01T00:00:00.000Z",
      source: "local-capture",
      branch: "main",
      base: "",
      level: "deep",
      results: {
        "built-in-agent": {
          _status: { status: "pass" },
        },
      },
      summary: { total: 1, pass: 1, fail: 0, skip: 0 },
    };
    const filePath = path.join(dir, "out.json");

    saveBaseline(baseline, filePath);

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(baseline);
  });
});

// ---------------------------------------------------------------------------
// captureBaseline
// ---------------------------------------------------------------------------

describe("captureBaseline", () => {
  let dir: string;
  let outDir: string;

  beforeEach(() => {
    dir = tmpDir();
    outDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("copies latest eval result as baseline with source: local-capture", () => {
    // Write two fake eval results — captureBaseline should pick the most
    // recently modified one.
    const older: EvalBaseline = {
      version: 1,
      timestamp: "2025-05-01T00:00:00.000Z",
      source: "harness-prod",
      branch: "old",
      base: "",
      level: "deep",
      results: {},
      summary: { total: 0, pass: 0, fail: 0, skip: 0 },
    };
    const newer: EvalBaseline = {
      version: 1,
      timestamp: "2025-06-01T00:00:00.000Z",
      source: "harness-prod",
      branch: "new",
      base: "",
      level: "deep",
      results: {
        mastra: {
          _status: { status: "pass" },
        },
      },
      summary: { total: 1, pass: 1, fail: 0, skip: 0 },
    };

    const olderPath = path.join(dir, "eval-2025-05-01.json");
    const newerPath = path.join(dir, "eval-2025-06-01.json");
    fs.writeFileSync(olderPath, JSON.stringify(older));
    // Ensure newer file has a later mtime
    const futureTime = new Date(Date.now() + 2000);
    fs.writeFileSync(newerPath, JSON.stringify(newer));
    fs.utimesSync(newerPath, futureTime, futureTime);

    const baselinePath = path.join(outDir, "baseline.json");
    captureBaseline(dir, baselinePath);

    const captured = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
    expect(captured.source).toBe("local-capture");
    expect(captured.branch).toBe("new");
    expect(captured.results).toEqual(newer.results);
  });
});
