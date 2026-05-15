import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Types under test (imported from runner.ts once it exists)
// ---------------------------------------------------------------------------
import type {
  TierConfig,
  TiersFile,
  RunOptions,
  TieredRunResult,
} from "./runner.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before vi.mock factories, so these
// variables are available inside the factory closures.
// ---------------------------------------------------------------------------
const { execFileMock, readFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs", () => ({
  default: { readFileSync: (...args: unknown[]) => readFileSyncMock(...args) },
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

// Now import the module under test
import { loadTiers, runSlug, runParallel, runTiered } from "./runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake execFile callback invocation for a successful slug run. */
function fakeExecFileSuccess(
  stdout: string,
  { delay = 0 }: { delay?: number } = {},
) {
  execFileMock.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: Record<string, unknown>,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const timeout = delay
        ? setTimeout(() => cb(null, stdout, ""), delay)
        : (cb(null, stdout, ""), undefined);
      return {
        pid: 1234,
        kill: () => {
          if (timeout) clearTimeout(timeout);
        },
      };
    },
  );
}

/** Create a fake execFile that exits with a non-zero code. */
function fakeExecFileFail(code: number, stderr = "") {
  execFileMock.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: Record<string, unknown>,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const err = Object.assign(new Error(`exit code ${code}`), {
        code,
        killed: false,
        signal: null,
      });
      cb(err, "", stderr);
      return { pid: 1234, kill: () => {} };
    },
  );
}

/** Create a fake execFile that times out (never calls callback). */
function fakeExecFileTimeout() {
  execFileMock.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      opts: Record<string, unknown>,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      // The runner should set a timeout. We simulate timeout by calling back
      // with a timeout-like error after maxBuffer / timeout.
      const err = Object.assign(new Error("Command timed out"), {
        killed: true,
        signal: "SIGTERM",
        code: null,
      });
      // Call back async to simulate timeout
      setTimeout(() => cb(err, "", ""), 10);
      return { pid: 1234, kill: () => {} };
    },
  );
}

/** Sample Playwright JSON reporter output for a passing test. */
function playwrightJsonOutput(
  slug: string,
  tests: Array<{
    title: string;
    status: string;
    duration: number;
    error?: string;
  }>,
): string {
  const suites = [
    {
      title: slug,
      specs: tests.map((t) => ({
        title: t.title,
        tests: [
          {
            results: [
              {
                status: t.status,
                duration: t.duration,
                error: t.error ? { message: t.error } : undefined,
              },
            ],
          },
        ],
      })),
    },
  ];
  return JSON.stringify({ suites });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadTiers", () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  it("reads tier config and resolves '*' wildcard against slug list", () => {
    const tiersFile: TiersFile = {
      tiers: [
        { name: "Gold Standard", slugs: ["langgraph-python"], fail_fast: true },
        {
          name: "Key Partners",
          slugs: ["mastra", "crewai-crews"],
          fail_fast: false,
        },
        { name: "Full Matrix", slugs: "*", fail_fast: false },
      ],
    };
    readFileSyncMock.mockReturnValueOnce(JSON.stringify(tiersFile));

    const allSlugs = [
      "langgraph-python",
      "mastra",
      "crewai-crews",
      "google-adk",
      "langgraph-typescript",
      "openai-swarm",
    ];

    const result = loadTiers("/path/to/eval-tiers.json", allSlugs);

    expect(result).toHaveLength(3);

    // Tier 1: exact slugs
    expect(result[0].name).toBe("Gold Standard");
    expect(result[0].slugs).toEqual(["langgraph-python"]);
    expect(result[0].fail_fast).toBe(true);

    // Tier 2: exact slugs
    expect(result[1].name).toBe("Key Partners");
    expect(result[1].slugs).toEqual(["mastra", "crewai-crews"]);

    // Tier 3: wildcard resolved — excludes slugs already in tiers 1 and 2
    expect(result[2].name).toBe("Full Matrix");
    expect(result[2].slugs).toEqual(
      expect.arrayContaining([
        "google-adk",
        "langgraph-typescript",
        "openai-swarm",
      ]),
    );
    expect(result[2].slugs).not.toContain("langgraph-python");
    expect(result[2].slugs).not.toContain("mastra");
    expect(result[2].slugs).not.toContain("crewai-crews");
  });

  it("handles missing file gracefully (returns single 'all' tier)", () => {
    readFileSyncMock.mockImplementationOnce(() => {
      const err = Object.assign(new Error("ENOENT"), {
        code: "ENOENT",
      });
      throw err;
    });

    const allSlugs = ["langgraph-python", "mastra"];
    const result = loadTiers("/nonexistent/eval-tiers.json", allSlugs);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("all");
    expect(result[0].slugs).toEqual(allSlugs);
    expect(result[0].fail_fast).toBe(false);
  });
});

describe("runSlug", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("parses Playwright JSON reporter output", async () => {
    const jsonOut = playwrightJsonOutput("langgraph-python", [
      { title: "sends chat message", status: "passed", duration: 1200 },
      { title: "uses tool", status: "passed", duration: 800 },
    ]);
    fakeExecFileSuccess(jsonOut);

    const result = await runSlug("langgraph-python", "d5", 30000, "/showcase");

    expect(result.slug).toBe("langgraph-python");
    expect(result.status).toBe("pass");
    expect(result.tests["langgraph-python > sends chat message"]).toBeDefined();
    expect(result.tests["langgraph-python > sends chat message"].status).toBe(
      "pass",
    );
    expect(
      result.tests["langgraph-python > sends chat message"].duration_ms,
    ).toBe(1200);
    expect(result.tests["langgraph-python > uses tool"].status).toBe("pass");
  });

  it("handles child process crash (non-zero exit, no JSON output)", async () => {
    fakeExecFileFail(1, "Segmentation fault");

    const result = await runSlug("crewai-crews", "d5", 30000, "/showcase");

    expect(result.slug).toBe("crewai-crews");
    expect(result.status).toBe("fail");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result.tests)).toHaveLength(0);
  });

  it("handles child process timeout", async () => {
    fakeExecFileTimeout();

    const result = await runSlug("slow-integration", "d5", 100, "/showcase");

    expect(result.slug).toBe("slow-integration");
    expect(result.status).toBe("fail");
  });
});

describe("runParallel", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("collects results from all slugs", async () => {
    const slugs = ["slug-a", "slug-b", "slug-c"];

    for (const slug of slugs) {
      const jsonOut = playwrightJsonOutput(slug, [
        { title: "basic test", status: "passed", duration: 500 },
      ]);
      fakeExecFileSuccess(jsonOut);
    }

    const opts: RunOptions = {
      level: "d5",
      maxParallel: 3,
      timeout: 30000,
      showcaseDir: "/showcase",
    };

    const results = await runParallel(slugs, opts);

    expect(results).toHaveLength(3);
    const resultSlugs = results.map((r) => r.slug).sort();
    expect(resultSlugs).toEqual(["slug-a", "slug-b", "slug-c"]);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  it("respects concurrency limit", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    // Override execFile to track concurrency
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        concurrentCount++;
        if (concurrentCount > maxConcurrent) {
          maxConcurrent = concurrentCount;
        }

        // Simulate async work
        setTimeout(() => {
          concurrentCount--;
          const jsonOut = playwrightJsonOutput("test", [
            { title: "t", status: "passed", duration: 100 },
          ]);
          cb(null, jsonOut, "");
        }, 50);

        return { pid: 1234, kill: () => {} };
      },
    );

    const slugs = ["a", "b", "c", "d", "e", "f"];
    const opts: RunOptions = {
      level: "d5",
      maxParallel: 2,
      timeout: 30000,
      showcaseDir: "/showcase",
    };

    const results = await runParallel(slugs, opts);

    expect(results).toHaveLength(6);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe("runTiered", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("executes tiers in order (tier 1 before tier 2)", async () => {
    const tiersFile: TiersFile = {
      tiers: [
        { name: "Tier 1", slugs: ["slug-a"], fail_fast: true },
        { name: "Tier 2", slugs: ["slug-b"], fail_fast: false },
      ],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(tiersFile));

    const executionOrder: string[] = [];

    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        // Extract slug from args — it's the argument after "test"
        const testIdx = args.indexOf("test");
        const slug = testIdx >= 0 ? args[testIdx + 1] : "unknown";
        executionOrder.push(slug);

        const jsonOut = playwrightJsonOutput(slug, [
          { title: "basic", status: "passed", duration: 100 },
        ]);
        cb(null, jsonOut, "");
        return { pid: 1234, kill: () => {} };
      },
    );

    const opts: RunOptions = {
      level: "d5",
      maxParallel: 2,
      timeout: 30000,
      showcaseDir: "/showcase",
    };

    const result = await runTiered(
      ["slug-a", "slug-b"],
      ["slug-a", "slug-b"],
      opts,
    );

    // Tier 1 slug should execute before tier 2 slug
    expect(executionOrder.indexOf("slug-a")).toBeLessThan(
      executionOrder.indexOf("slug-b"),
    );
    expect(result.tierSummaries).toHaveLength(2);
    expect(result.tierSummaries[0].name).toBe("Tier 1");
    expect(result.tierSummaries[1].name).toBe("Tier 2");
  });

  it("stops on tier 1 fail-fast when regression detected", async () => {
    const tiersFile: TiersFile = {
      tiers: [
        { name: "Gold Standard", slugs: ["slug-a"], fail_fast: true },
        { name: "Rest", slugs: ["slug-b"], fail_fast: false },
      ],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(tiersFile));

    // slug-a fails
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const testIdx = args.indexOf("test");
        const slug = testIdx >= 0 ? args[testIdx + 1] : "unknown";

        if (slug === "slug-a") {
          const jsonOut = playwrightJsonOutput(slug, [
            {
              title: "basic",
              status: "failed",
              duration: 100,
              error: "assertion failed",
            },
          ]);
          cb(null, jsonOut, "");
        } else {
          const jsonOut = playwrightJsonOutput(slug, [
            { title: "basic", status: "passed", duration: 100 },
          ]);
          cb(null, jsonOut, "");
        }
        return { pid: 1234, kill: () => {} };
      },
    );

    const opts: RunOptions = {
      level: "d5",
      maxParallel: 2,
      timeout: 30000,
      showcaseDir: "/showcase",
    };

    const result = await runTiered(
      ["slug-a", "slug-b"],
      ["slug-a", "slug-b"],
      opts,
    );

    // Should have stopped after tier 1
    expect(result.abortedAtTier).toBe(0);
    expect(result.tierSummaries).toHaveLength(1);
    // slug-b should be skipped
    const slugBResult = result.results.find((r) => r.slug === "slug-b");
    expect(slugBResult).toBeUndefined();
  });

  it("continues through all tiers when noFailFast=true", async () => {
    const tiersFile: TiersFile = {
      tiers: [
        { name: "Gold Standard", slugs: ["slug-a"], fail_fast: true },
        { name: "Rest", slugs: ["slug-b"], fail_fast: false },
      ],
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(tiersFile));

    // slug-a fails
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const testIdx = args.indexOf("test");
        const slug = testIdx >= 0 ? args[testIdx + 1] : "unknown";

        if (slug === "slug-a") {
          const jsonOut = playwrightJsonOutput(slug, [
            {
              title: "basic",
              status: "failed",
              duration: 100,
              error: "assertion failed",
            },
          ]);
          cb(null, jsonOut, "");
        } else {
          const jsonOut = playwrightJsonOutput(slug, [
            { title: "basic", status: "passed", duration: 100 },
          ]);
          cb(null, jsonOut, "");
        }
        return { pid: 1234, kill: () => {} };
      },
    );

    const opts: RunOptions = {
      level: "d5",
      maxParallel: 2,
      timeout: 30000,
      showcaseDir: "/showcase",
      noFailFast: true,
    };

    const result = await runTiered(
      ["slug-a", "slug-b"],
      ["slug-a", "slug-b"],
      opts,
    );

    // Should NOT have stopped — continued through both tiers
    expect(result.abortedAtTier).toBeUndefined();
    expect(result.tierSummaries).toHaveLength(2);
    expect(result.results).toHaveLength(2);
  });
});
