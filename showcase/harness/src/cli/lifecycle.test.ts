import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  // readFileSync is consulted by loadPortsFile() to map slugs → host ports
  // for health checks; provide stub ports for any slug the up() tests use.
  const api = {
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() =>
      JSON.stringify({
        "langgraph-python": 10001,
        a: 10002,
        b: 10003,
      }),
    ),
  };
  return { default: api, ...api };
});

import { rebuild, up } from "./lifecycle.js";

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

describe("up() — scoped --build (A21)", () => {
  // Stub healthCheck transitively by making fetch unreachable but compose succeed.
  // up() throws on unhealthy services, so we mock the health-check path via
  // network fetch failing — but the IMPORTANT assertion is the compose argv
  // captured by composeCalls() BEFORE health checks run.
  // To avoid up() throwing before we can assert, mock fetch globally to resolve OK.
  const _origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200 } as Response),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = _origFetch;
  });

  /**
   * The compose argv shape we want:
   *   [--profile infra --profile <slug>... up -d --build <slug>...]
   *
   * Without slug positionals AFTER `--build`, compose rebuilds EVERY service
   * in every active profile (infra + slug profiles). With slug positionals,
   * compose rebuilds ONLY the named services and uses cached images for
   * everything else — that is the A21 fix.
   *
   * `--profile <name>` arguments do NOT scope the build target on their own;
   * docker compose only treats positional args after `up` as the service
   * filter for `--build`. So the test asserts the slug appears AFTER the `up`
   * keyword (as a positional), not merely anywhere in the argv.
   */
  function positionalsAfterUp(argv: string[]): string[] {
    const upIdx = argv.indexOf("up");
    if (upIdx < 0) return [];
    const out: string[] = [];
    for (let i = upIdx + 1; i < argv.length; i++) {
      const tok = argv[i];
      // Skip flags and their values. `-d`/`--build` take no value; `--progress`
      // takes a value. Keep it simple — the only flags we emit here are
      // `-d`, `--build`, `--progress plain`.
      if (tok === "-d" || tok === "--build") continue;
      if (tok === "--progress") {
        i++; // skip the value
        continue;
      }
      if (tok.startsWith("-")) continue;
      out.push(tok);
    }
    return out;
  }

  it("scopes --build to the targeted slug (does NOT rebuild infra services)", async () => {
    await up(["langgraph-python"]);

    const upCall = composeCalls().find(
      (argv) => argv.includes("up") && argv.includes("--build"),
    );
    expect(upCall).toBeDefined();
    // The slug must appear as a positional AFTER `up` so compose treats it as
    // the build target filter — not merely as a `--profile <slug>` argument
    // (profiles don't scope --build).
    expect(positionalsAfterUp(upCall!)).toEqual(["langgraph-python"]);
  });

  it("with no slugs (infra-only), --build remains blanket (first-time bootstrap)", async () => {
    await up([]);

    const upCall = composeCalls().find(
      (argv) => argv.includes("up") && argv.includes("--build"),
    );
    expect(upCall).toBeDefined();
    // No slug positional after `up`: compose builds whatever is missing in the
    // infra profile (cached images skipped, fresh ones built). This preserves
    // first-time bootstrap behaviour when no infra images exist yet.
    expect(positionalsAfterUp(upCall!)).toEqual([]);
  });

  it("multi-slug: scopes --build to ALL targeted slugs", async () => {
    await up(["a", "b"]);

    const upCall = composeCalls().find(
      (argv) => argv.includes("up") && argv.includes("--build"),
    );
    expect(upCall).toBeDefined();
    expect(positionalsAfterUp(upCall!).sort()).toEqual(["a", "b"]);
  });
});
