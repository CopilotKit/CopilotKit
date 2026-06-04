import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before vi.mock factories so the spies
// are available inside the factory closures. We capture every
// `docker compose ...` invocation by recording execFileSync calls.
// ---------------------------------------------------------------------------
const { execFileSyncMock, execSyncMock, existsSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  execSync: (...args: unknown[]) => execSyncMock(...args),
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => {
  // stageSharedModules() short-circuits when INTEGRATIONS_DIR is absent.
  const api = {
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => "{}"),
  };
  return { default: api, ...api };
});

import { rebuild } from "./lifecycle.js";

/** Pull out the compose argv (after the `-f <file>` prefix) for each call. */
function composeCalls(): string[][] {
  return execFileSyncMock.mock.calls
    .filter((c) => c[0] === "docker")
    .map((c) => c[1] as string[])
    .filter((argv) => argv[0] === "compose")
    .map((argv) => argv.slice(3)); // drop ["compose", "-f", "<file>"]
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  execSyncMock.mockReset();
  existsSyncMock.mockReset();
  // No integrations dir → stageSharedModules() is a no-op.
  existsSyncMock.mockReturnValue(false);
  // Default: compose returns empty string.
  execFileSyncMock.mockReturnValue("");
});

describe("rebuild() — targeted slugs", () => {
  it("includes the infra profile in the build invocation so aimock resolves", async () => {
    await rebuild(["langgraph-python"]);

    const buildCall = composeCalls().find((argv) => argv.includes("build"));
    expect(buildCall).toBeDefined();
    // infra profile must be present alongside the slug profile
    expect(buildCall).toContain("--profile");
    expect(buildCall).toContain("infra");
    expect(buildCall).toContain("langgraph-python");
    // sanity: --profile infra appears before build
    const infraIdx = buildCall!.indexOf("infra");
    const buildIdx = buildCall!.indexOf("build");
    expect(infraIdx).toBeLessThan(buildIdx);
  });

  it("force-recreates the targeted service so a stale container is replaced", async () => {
    await rebuild(["langgraph-python"]);

    const recreateCall = composeCalls().find(
      (argv) => argv.includes("up") && argv.includes("--force-recreate"),
    );
    expect(recreateCall).toBeDefined();
    expect(recreateCall).toContain("infra"); // infra profile included here too
    expect(recreateCall).toContain("langgraph-python");
    expect(recreateCall).toContain("-d");
  });

  it("recreates EVERY targeted slug regardless of prior running state", async () => {
    // isRunning is no longer consulted for the targeted path — force-recreate
    // is unconditional. Verify both slugs get rebuilt + recreated.
    await rebuild(["a", "b"]);

    const buildCall = composeCalls().find((argv) => argv.includes("build"));
    expect(buildCall).toContain("a");
    expect(buildCall).toContain("b");

    const recreateCall = composeCalls().find((argv) =>
      argv.includes("--force-recreate"),
    );
    expect(recreateCall).toContain("a");
    expect(recreateCall).toContain("b");
  });
});
