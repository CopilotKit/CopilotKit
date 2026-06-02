import { describe, it, expect, vi, beforeEach } from "vitest";
import realFs from "node:fs";
import type * as NodeFs from "node:fs";

// ---------------------------------------------------------------------------
// Mock node:fs so resolveIntegrationDir can be exercised without a real tree.
// Only `existsSync` is stubbed; every other fs call (readFileSync,
// writeFileSync, mkdtempSync, rmSync — used by runE2eAndParse's temp-file
// flow) passes through to the real implementation so the JSON round-trip is
// exercised end-to-end.
// ---------------------------------------------------------------------------
const { existsSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof NodeFs;
  const patched = {
    ...actual,
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
  };
  return { ...patched, default: patched };
});

import {
  buildE2eCommand,
  resolveIntegrationDir,
  runE2eAndParse,
} from "./e2e.js";
import type { LocalConfig } from "./config.js";

const config = {
  showcaseDir: "/repo/showcase",
  localPorts: { "langgraph-python": 3100, mastra: 3104 },
} as unknown as LocalConfig;

beforeEach(() => {
  existsSyncMock.mockReset();
  // Default: integrations/<slug>/playwright.config.ts exists.
  existsSyncMock.mockImplementation((p: string) =>
    p.includes("/integrations/"),
  );
});

describe("resolveIntegrationDir", () => {
  it("resolves the integrations/<slug> directory when its playwright config exists", () => {
    expect(resolveIntegrationDir("langgraph-python", config)).toBe(
      "/repo/showcase/integrations/langgraph-python",
    );
  });

  it("falls back to packages/<slug> when only that config exists", () => {
    existsSyncMock.mockImplementation((p: string) => p.includes("/packages/"));
    expect(resolveIntegrationDir("langgraph-python", config)).toBe(
      "/repo/showcase/packages/langgraph-python",
    );
  });

  it("throws when no playwright config is found", () => {
    existsSyncMock.mockReturnValue(false);
    expect(() => resolveIntegrationDir("nope", config)).toThrow(
      /No Playwright e2e suite/,
    );
  });
});

describe("buildE2eCommand", () => {
  it("forces CI=1 and resolves BASE_URL from the integration's local port", () => {
    const cmd = buildE2eCommand("langgraph-python", { tier: "d6" }, config);
    expect(cmd.env.CI).toBe("1");
    expect(cmd.env.BASE_URL).toBe("http://localhost:3100");
    expect(cmd.cwd).toBe("/repo/showcase/integrations/langgraph-python");
  });

  it("builds a deterministic playwright invocation with line reporter and 1 worker / 0 retries by default", () => {
    const cmd = buildE2eCommand("langgraph-python", { tier: "d6" }, config);
    expect(cmd.command).toBe("npx");
    expect(cmd.args).toEqual([
      "playwright",
      "test",
      "--reporter=line",
      "--workers=1",
      "--retries=0",
    ]);
  });

  it("passes the grep filter through as -g", () => {
    const cmd = buildE2eCommand(
      "langgraph-python",
      { tier: "d6", grep: "Write a blog post" },
      config,
    );
    expect(cmd.args).toContain("-g");
    expect(cmd.args[cmd.args.indexOf("-g") + 1]).toBe("Write a blog post");
  });

  it("places an explicit spec filter before the flag args", () => {
    const cmd = buildE2eCommand(
      "langgraph-python",
      { tier: "d6", spec: "subagents" },
      config,
    );
    expect(cmd.args).toEqual([
      "playwright",
      "test",
      "subagents",
      "--reporter=line",
      "--workers=1",
      "--retries=0",
    ]);
  });

  it("honors worker/retry overrides and --headed", () => {
    const cmd = buildE2eCommand(
      "mastra",
      { tier: "deep", workers: 4, retries: 2, headed: true },
      config,
    );
    expect(cmd.args).toContain("--workers=4");
    expect(cmd.args).toContain("--retries=2");
    expect(cmd.args).toContain("--headed");
    expect(cmd.env.BASE_URL).toBe("http://localhost:3104");
  });

  it("throws for a slug with no local port mapping", () => {
    expect(() => buildE2eCommand("ghost-slug", { tier: "d6" }, config)).toThrow(
      /No local port mapping/,
    );
  });

  it("uses baseUrlOverride and never touches the port map when set", () => {
    // A slug with no port mapping must still build a command when the URL is
    // supplied directly (the probe-driver path).
    const cmd = buildE2eCommand(
      "ghost-slug",
      { tier: "d6", baseUrlOverride: "https://live.example.com" },
      config,
    );
    expect(cmd.env.BASE_URL).toBe("https://live.example.com");
  });

  // --- retries parameterization (strict vs production) -------------------
  // The probe-driver path passes retries:1 (a retried PASS counts green);
  // strict validation/CI passes retries:0 (no flake masking). Both must
  // emit the matching --retries arg, NOT a hardcoded value.
  it("emits --retries=0 for the strict path", () => {
    const cmd = buildE2eCommand(
      "langgraph-python",
      { tier: "d6", retries: 0 },
      config,
    );
    expect(cmd.args).toContain("--retries=0");
  });

  it("emits --retries=1 for the production probe path", () => {
    const cmd = buildE2eCommand(
      "langgraph-python",
      { tier: "d6", retries: 1 },
      config,
    );
    expect(cmd.args).toContain("--retries=1");
  });

  // --- JSON reporter capture --------------------------------------------
  // When a jsonOutputFile is requested, the command must add the json
  // reporter (alongside the human `line` reporter) and point Playwright's
  // PLAYWRIGHT_JSON_OUTPUT_NAME at that file. Without it, the command keeps
  // the bare `--reporter=line` (the human CLI contract).
  it("adds the json reporter and PLAYWRIGHT_JSON_OUTPUT_NAME when jsonOutputFile is set", () => {
    const cmd = buildE2eCommand(
      "langgraph-python",
      { tier: "d6", retries: 1, jsonOutputFile: "/tmp/d6-out.json" },
      config,
    );
    expect(cmd.args).toContain("--reporter=line,json");
    expect(cmd.args).not.toContain("--reporter=line");
    expect(cmd.env.PLAYWRIGHT_JSON_OUTPUT_NAME).toBe("/tmp/d6-out.json");
  });

  it("keeps the bare line reporter and no JSON env when jsonOutputFile is absent", () => {
    const cmd = buildE2eCommand("langgraph-python", { tier: "d6" }, config);
    expect(cmd.args).toContain("--reporter=line");
    expect(cmd.args).not.toContain("--reporter=line,json");
    expect(cmd.env.PLAYWRIGHT_JSON_OUTPUT_NAME).toBeUndefined();
  });

  it("threads PLAYWRIGHT_WS_ENDPOINT into the env when the env var is set", () => {
    const prev = process.env.PLAYWRIGHT_WS_ENDPOINT;
    process.env.PLAYWRIGHT_WS_ENDPOINT = "ws://127.0.0.1:9999/abc123";
    try {
      const cmd = buildE2eCommand("langgraph-python", { tier: "d6" }, config);
      expect(cmd.env.PLAYWRIGHT_WS_ENDPOINT).toBe("ws://127.0.0.1:9999/abc123");
    } finally {
      if (prev === undefined) delete process.env.PLAYWRIGHT_WS_ENDPOINT;
      else process.env.PLAYWRIGHT_WS_ENDPOINT = prev;
    }
  });

  it("omits PLAYWRIGHT_WS_ENDPOINT from the env when the env var is unset", () => {
    const prev = process.env.PLAYWRIGHT_WS_ENDPOINT;
    delete process.env.PLAYWRIGHT_WS_ENDPOINT;
    try {
      const cmd = buildE2eCommand("langgraph-python", { tier: "d6" }, config);
      expect(cmd.env.PLAYWRIGHT_WS_ENDPOINT).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.PLAYWRIGHT_WS_ENDPOINT = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// runE2eAndParse — runs the suite with a JSON reporter, parses the temp file
// into per-spec results. Fail-closed: a run that errors before producing
// parseable JSON yields specResults: [] (the rollup maps absence → unknown).
// ---------------------------------------------------------------------------
describe("runE2eAndParse", () => {
  it("parses the Playwright JSON temp file into specResults and returns the exit code", () => {
    const reportFixture = {
      suites: [
        {
          file: "agentic-chat.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "passed" }] }] },
          ],
        },
        {
          file: "frontend-tools.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "timedOut" }] }] },
          ],
        },
      ],
    };

    let capturedJsonPath: string | undefined;
    const result = runE2eAndParse("langgraph-python", { retries: 1 }, config, {
      // Inject the runner so the test never spawns Playwright: it writes the
      // fixture JSON to the path the command targets, then returns exit code.
      execImpl: (_cmd, jsonOutputFile) => {
        capturedJsonPath = jsonOutputFile;
        realFs.writeFileSync(jsonOutputFile, JSON.stringify(reportFixture));
        return 1; // a failing run
      },
    });

    expect(capturedJsonPath).toBeDefined();
    expect(result.exitCode).toBe(1);
    const agentic = result.specResults.find(
      (r) => r.specFile === "agentic-chat.spec.ts",
    );
    const frontend = result.specResults.find(
      (r) => r.specFile === "frontend-tools.spec.ts",
    );
    expect(agentic?.fileVerdict).toBe("pass");
    expect(frontend?.fileVerdict).toBe("red");
  });

  it("fail-closed: returns empty specResults when no JSON is produced (run errored)", () => {
    const result = runE2eAndParse("langgraph-python", { retries: 1 }, config, {
      // Never writes the JSON file — simulates a crash before any report.
      execImpl: () => 1,
    });
    expect(result.specResults).toEqual([]);
    expect(result.exitCode).toBe(1);
  });
});
