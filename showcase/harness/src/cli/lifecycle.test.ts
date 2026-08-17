import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before vi.mock factories so the spies
// are available inside the factory closures. We capture every
// `docker compose ...` invocation by recording execFileSync calls.
// ---------------------------------------------------------------------------
const {
  execFileSyncMock,
  execSyncMock,
  existsSyncMock,
  readdirSyncMock,
  lstatSyncMock,
  readlinkSyncMock,
  statSyncMock,
  rmSyncMock,
  cpSyncMock,
  writeFileSyncMock,
} = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  lstatSyncMock: vi.fn(),
  readlinkSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
  cpSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
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
    readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
    lstatSync: (...args: unknown[]) => lstatSyncMock(...args),
    readlinkSync: (...args: unknown[]) => readlinkSyncMock(...args),
    statSync: (...args: unknown[]) => statSyncMock(...args),
    rmSync: (...args: unknown[]) => rmSyncMock(...args),
    cpSync: (...args: unknown[]) => cpSyncMock(...args),
    writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
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

import { down, rebuild, stageSharedModules, up } from "./lifecycle.js";

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
  readdirSyncMock.mockReset();
  lstatSyncMock.mockReset();
  readlinkSyncMock.mockReset();
  statSyncMock.mockReset();
  rmSyncMock.mockReset();
  cpSyncMock.mockReset();
  writeFileSyncMock.mockReset();
  // No integrations dir → stageSharedModules() is a no-op.
  existsSyncMock.mockReturnValue(false);
  readdirSyncMock.mockReturnValue([]);
  // Default: compose returns empty string.
  execFileSyncMock.mockReturnValue("");
});

describe("stageSharedModules() — Angular browser artifact", () => {
  it("materializes the Angular browser build inside each integration context", () => {
    existsSyncMock.mockImplementation((candidate: unknown) => {
      const value = String(candidate);
      return (
        value.endsWith("/showcase/integrations") ||
        value.endsWith("/showcase/angular/dist/showcase-angular/browser")
      );
    });
    readdirSyncMock.mockReturnValue([
      {
        name: "langgraph-python",
        isDirectory: () => true,
      },
    ]);
    lstatSyncMock.mockImplementation((candidate: unknown) => ({
      isSymbolicLink: () => String(candidate).endsWith("/public/angular"),
    }));

    stageSharedModules();

    expect(rmSyncMock).toHaveBeenCalledWith(
      expect.stringMatching(/integrations\/langgraph-python\/public\/angular$/),
    );
    expect(cpSyncMock).toHaveBeenCalledWith(
      expect.stringMatching(/angular\/dist\/showcase-angular\/browser$/),
      expect.stringMatching(/integrations\/langgraph-python\/public\/angular$/),
      { recursive: true },
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /integrations\/langgraph-python\/public\/angular\/runtime-config\.js$/,
      ),
      expect.stringContaining('"integrationId":"langgraph-python"'),
      "utf-8",
    );
  });
});

describe("stageSharedModules() — shared data", () => {
  it("materializes an integration data symlink inside its Docker build context", () => {
    existsSyncMock.mockImplementation((candidate: unknown) => {
      const value = String(candidate);
      return (
        value.endsWith("/showcase/integrations") ||
        value.endsWith("/showcase/shared/python/data")
      );
    });
    readdirSyncMock.mockReturnValue([
      {
        name: "crewai-crews",
        isDirectory: () => true,
      },
    ]);
    lstatSyncMock.mockImplementation((candidate: unknown) => ({
      isSymbolicLink: () => String(candidate).endsWith("/data"),
    }));
    readlinkSyncMock.mockReturnValue("../../shared/python/data");
    statSyncMock.mockReturnValue({ isDirectory: () => true });

    stageSharedModules();

    expect(rmSyncMock).toHaveBeenCalledWith(
      expect.stringMatching(/integrations\/crewai-crews\/data$/),
    );
    expect(cpSyncMock).toHaveBeenCalledWith(
      expect.stringMatching(/showcase\/shared\/python\/data$/),
      expect.stringMatching(/integrations\/crewai-crews\/data$/),
      { recursive: true },
    );
  });
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

describe("down() — targeted slugs", () => {
  it("loads the infra profile so integration dependencies resolve", async () => {
    await down(["ag2"]);

    expect(composeCalls()).toContainEqual([
      "--profile",
      "infra",
      "--profile",
      "ag2",
      "stop",
      "ag2",
    ]);
  });
});

describe("up() — two-call infra-start + scoped --build (A21b)", () => {
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
   * The two-call shape we want when slugs are provided:
   *   Call 1: [--profile infra --profile <slug>... up -d]
   *     (no --build, no positional services — brings up ALL services in
   *     active profiles using cached images)
   *   Call 2: [--profile infra --profile <slug>... up -d --build <slug>...]
   *     (rebuilds ONLY the named services; others are no-ops)
   *
   * Background: docker compose positional service names after `up` restrict
   * WHICH services start (not just which get rebuilt). A21's single-call
   * `up -d --build <slug>` therefore prevented infra services without an
   * explicit `depends_on` from the slug from starting at all — health checks
   * crossed onto sibling stack containers and cells silently misrouted (0.0s
   * red). A21b splits into two calls to keep target-only rebuild while
   * restoring the full infra startup.
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

  /** Pull the `--profile <name>` set from a compose argv. */
  function profilesIn(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length - 1; i++) {
      if (argv[i] === "--profile") out.push(argv[i + 1]);
    }
    return out.sort();
  }

  it("emits TWO compose calls when slugs provided: infra-up then target-build", async () => {
    await up(["langgraph-python"]);

    const upCalls = composeCalls().filter((argv) => argv.includes("up"));
    expect(upCalls.length).toBe(2);

    // Call 1: no --build, no positional services.
    const [call1, call2] = upCalls;
    expect(call1).not.toContain("--build");
    expect(positionalsAfterUp(call1)).toEqual([]);

    // Call 2: --build present, slug as positional after `up`.
    expect(call2).toContain("--build");
    expect(positionalsAfterUp(call2)).toEqual(["langgraph-python"]);
  });

  it("with no slugs (infra-only), emits a SINGLE blanket --build call", async () => {
    await up([]);

    const upCalls = composeCalls().filter((argv) => argv.includes("up"));
    expect(upCalls.length).toBe(1);
    const [call] = upCalls;
    expect(call).toContain("--build");
    // No slug positional after `up`: compose builds whatever is missing in the
    // infra profile (cached images skipped, fresh ones built). This preserves
    // first-time bootstrap behaviour when no infra images exist yet.
    expect(positionalsAfterUp(call)).toEqual([]);
  });

  it("multi-slug: scopes --build to ALL targeted slugs (call 2)", async () => {
    await up(["a", "b"]);

    const upCalls = composeCalls().filter((argv) => argv.includes("up"));
    expect(upCalls.length).toBe(2);
    const [, call2] = upCalls;
    expect(call2).toContain("--build");
    expect(positionalsAfterUp(call2).sort()).toEqual(["a", "b"]);
  });

  it("both calls use IDENTICAL profile flags (no profile drift)", async () => {
    await up(["langgraph-python"]);

    const upCalls = composeCalls().filter((argv) => argv.includes("up"));
    expect(upCalls.length).toBe(2);
    const [call1, call2] = upCalls;
    // Same --profile set in both calls so services across calls agree on
    // which profiles are "active" — drift here would mean call 1 brings up a
    // service that call 2 doesn't know about (or vice versa).
    expect(profilesIn(call1)).toEqual(profilesIn(call2));
    // And the slug's profile is actually present.
    expect(profilesIn(call1)).toContain("infra");
    expect(profilesIn(call1)).toContain("langgraph-python");
  });
});

// =====================================================================
// up() health-gates the UNIFIED FRONTEND.
//
// `frontend-nextjs` is in the `infra` compose profile, so every `up` path
// already STARTS it — but it has NO entry in shared/local-ports.json (that
// file maps integration slugs to their own container ports, and the
// frontend is not an integration). Before it was added to INFRA_PORTS,
// `up()` therefore never WAITED for it: a probe could launch against a
// frontend that was not yet listening, and the browser's ECONNREFUSED
// surfaced as a ~0.0s red cell that looked like a broken demo.
// =====================================================================
describe("up() — unified frontend health gate", () => {
  const _origFetch = globalThis.fetch;
  const _origTimeout = process.env.SHOWCASE_HEALTHCHECK_TIMEOUT_MS;
  let probed: string[];

  beforeEach(() => {
    probed = [];
    // Keep the retry loop short: an unhealthy service otherwise re-polls for
    // the 90s default. 500ms is small enough to bound the unhealthy case to a
    // single poll + one 2s interval sleep, and large enough that a healthy
    // service is never marked unhealthy because its deadline elapsed before
    // its first fetch (which a 1ms budget did, flakily, for whichever service
    // the event loop reached last).
    process.env.SHOWCASE_HEALTHCHECK_TIMEOUT_MS = "500";
    globalThis.fetch = vi.fn((url: unknown) => {
      probed.push(String(url));
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = _origFetch;
    if (_origTimeout === undefined) {
      delete process.env.SHOWCASE_HEALTHCHECK_TIMEOUT_MS;
    } else {
      process.env.SHOWCASE_HEALTHCHECK_TIMEOUT_MS = _origTimeout;
    }
  });

  it("waits for the frontend on an infra-only bring-up", async () => {
    await up([]);
    // 3200 is the host port docker-compose.local.yml publishes ("3200:3000"),
    // and /api/health is the same dedicated route the compose healthcheck uses
    // (src/app/api/health/route.ts) — NOT `/`, which would render the whole
    // home page on every poll.
    expect(probed).toContain("http://localhost:3200/api/health");
  });

  it("waits for the frontend when slugs are targeted too", async () => {
    await up(["langgraph-python"]);
    expect(probed).toContain("http://localhost:3200/api/health");
  });

  it("still gates the pre-existing infra services (no gate was traded away)", async () => {
    await up([]);
    expect(probed).toContain("http://localhost:4010/health");
    expect(probed).toContain("http://localhost:8090/api/health");
    expect(probed).toContain("http://localhost:3210/");
  });

  it("FAILS the bring-up, naming frontend-nextjs, when the frontend never answers", async () => {
    // The point of the gate: an unlistening frontend must stop `up` rather
    // than let a probe start against it.
    globalThis.fetch = vi.fn((url: unknown) => {
      const href = String(url);
      probed.push(href);
      if (href.startsWith("http://localhost:3200")) {
        return Promise.reject(new Error("ECONNREFUSED"));
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;

    await expect(up([])).rejects.toThrow(/frontend-nextjs/);
  });
});
