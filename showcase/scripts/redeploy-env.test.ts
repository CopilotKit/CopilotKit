import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expandImageConsumers,
  parseArgs,
  runRedeploy,
  resolveTargetServices,
} from "./redeploy-env";
import { SERVICES } from "./railway-envs";

describe("runRedeploy", () => {
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let summary: string;

  beforeEach(() => {
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // runRedeploy's per-service progress lines go to process.stdout.write
    // (NOT console.log); spy on that too or tests spam the terminal.
    stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    summary = "";
    // runRedeploy unconditionally honors $REDEPLOY_SUMMARY_JSON — if the
    // test process inherits it (e.g. from a CI step), every runRedeploy
    // call here would write a real file. Stub it out (undefined deletes
    // the var) so tests never touch the filesystem.
    vi.stubEnv("REDEPLOY_SUMMARY_JSON", undefined);
  });

  afterEach(() => {
    consoleErrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    // vi.restoreAllMocks/mockRestore do NOT undo stubEnv — unstub
    // explicitly or the stub leaks into other files under fork reuse.
    vi.unstubAllEnvs();
  });

  const appendSummary = (s: string) => {
    summary += s + "\n";
  };

  it("default staging scope = 26 CI-built services + their imageOf consumers (harness-workers)", async () => {
    const seenNames: string[] = [];
    const redeploy = vi.fn(async (serviceId: string) => {
      // Reverse-lookup the SSOT name from serviceId so the test can
      // assert exact membership rather than counting opaquely.
      const name = Object.entries(SERVICES).find(
        ([, e]) => e.serviceId === serviceId,
      )?.[0];
      if (name) seenNames.push(name);
      return { ok: true as const };
    });

    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      // services omitted → default = CI_BUILT_SERVICES ∪ imageOf consumers
    });

    expect(result.exitCode).toBe(0);
    expect(result.attempted).toBe(27);
    expect(result.succeeded).toBe(27);
    expect(redeploy).toHaveBeenCalledTimes(27);
    // pocketbase is now CI-built, so it IS in the default redeploy scope.
    expect(seenNames).toContain("pocketbase");
    // harness-workers runs the shared showcase-harness image (imageOf:
    // "harness") and must follow the scheduler into the staging scope.
    expect(seenNames).toContain("harness-workers");
    // webhooks remains out-of-band.
    expect(seenNames).not.toContain("webhooks");
  });

  it("explicit --services harness pulls in its imageOf consumer harness-workers (staging)", async () => {
    // THE regression behind PR #5352: CI rebuilds showcase-harness:latest
    // and passes only the built slot (`showcase-harness` dispatch_name) to
    // redeploy-env.ts — the workers run the SAME image and silently kept
    // the stale one. The scope must expand to every imageOf consumer.
    const seenIds: string[] = [];
    const redeploy = vi.fn(async (serviceId: string) => {
      seenIds.push(serviceId);
      return { ok: true as const };
    });
    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-harness"], // the build matrix dispatch_name
    });
    expect(result.attempted).toBe(2);
    expect(seenIds).toEqual([
      SERVICES.harness.serviceId, // alphabetical iteration
      SERVICES["harness-workers"].serviceId,
    ]);
  });

  it("default prod scope does NOT include the staging-only harness-workers", async () => {
    // imageOf expansion is env-aware: harness-workers has no prod env, so
    // prod behavior is unchanged (26 CI-built services, no worker).
    const seenNames: string[] = [];
    const redeploy = vi.fn(async (serviceId: string) => {
      const name = Object.entries(SERVICES).find(
        ([, e]) => e.serviceId === serviceId,
      )?.[0];
      if (name) seenNames.push(name);
      return { ok: true as const };
    });
    const result = await runRedeploy({
      env: "prod",
      redeploy,
      appendSummary,
    });
    expect(result.attempted).toBe(26);
    expect(seenNames).not.toContain("harness-workers");
  });

  it("default whole-env staging redeploy NEVER bounces webhooks (out-of-band)", async () => {
    // Anti-regression: webhooks is released by its own repo's workflow
    // and must stay out of the default redeploy scope. pocketbase, by
    // contrast, is now CI-built and IS legitimately in the default scope.
    const seenIds = new Set<string>();
    const redeploy = vi.fn(async (serviceId: string) => {
      seenIds.add(serviceId);
      return { ok: true as const };
    });
    await runRedeploy({ env: "staging", redeploy, appendSummary });
    expect(seenIds.has(SERVICES.webhooks.serviceId)).toBe(false);
    expect(seenIds.has(SERVICES.pocketbase.serviceId)).toBe(true);
  });

  it("explicit --services list targets exactly that subset", async () => {
    const seenIds: string[] = [];
    const redeploy = vi.fn(async (serviceId: string) => {
      seenIds.push(serviceId);
      return { ok: true as const };
    });
    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-mastra", "showcase-ag2"],
    });
    expect(result.attempted).toBe(2);
    expect(seenIds).toEqual([
      SERVICES["showcase-ag2"].serviceId, // alphabetical iteration
      SERVICES["showcase-mastra"].serviceId,
    ]);
  });

  it("targets the staging env id", async () => {
    const calls: Array<{ environmentId: string }> = [];
    const redeploy = vi.fn(async (_svc: string, environmentId: string) => {
      calls.push({ environmentId });
      return { ok: true as const };
    });
    await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    for (const c of calls) {
      expect(c.environmentId).toBe("8edfef02-ea09-4a20-8689-261f21cc2849");
    }
  });

  it("targets the prod env id when env=prod", async () => {
    const calls: Array<{ environmentId: string }> = [];
    const redeploy = vi.fn(async (_svc: string, environmentId: string) => {
      calls.push({ environmentId });
      return { ok: true as const };
    });
    await runRedeploy({
      env: "prod",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    for (const c of calls) {
      expect(c.environmentId).toBe("b14919f4-6417-429f-848d-c6ae2201e04f");
    }
  });

  it("treats per-service failures as non-fatal and exits 0", async () => {
    // Deterministic: fail on a specific named service so the test does
    // not depend on the size of the default scope.
    const failTarget = SERVICES["showcase-mastra"].serviceId;
    const redeploy = vi.fn(async (serviceId: string) => {
      if (serviceId === failTarget) {
        return { ok: false as const, error: "boom" };
      }
      return { ok: true as const };
    });

    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
    });

    expect(result.exitCode).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.succeeded + result.failed).toBe(result.attempted);
    // Failure must be visible in the summary.
    expect(summary).toMatch(/FAIL/);
    expect(summary).toMatch(/boom/);
  });

  it("per-service catch records non-Error throws (null, string) as failures without crashing", async () => {
    // Catch block previously did `(e as Error).message ?? String(e)`,
    // which throws TypeError when e is null.
    const failTarget = SERVICES["showcase-mastra"].serviceId;
    const redeploy = vi.fn(async (serviceId: string) => {
      if (serviceId === failTarget) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw null;
      }
      return { ok: true as const };
    });

    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
    });

    expect(result.exitCode).toBe(0);
    expect(result.failed).toBe(1);
    expect(summary).toMatch(/FAIL/);
  });

  it("env=prod returns non-zero exitCode on per-service failure", async () => {
    // Prod isn't wired yet, but the design must NOT silently swallow
    // prod per-service failures the way staging intentionally does.
    const redeploy = vi.fn(async () => ({
      ok: false as const,
      error: "kaboom",
    }));
    const result = await runRedeploy({
      env: "prod",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    expect(result.failed).toBe(1);
    expect(result.exitCode).not.toBe(0);
  });

  it("env=prod returns exitCode 0 when all services succeed", async () => {
    const redeploy = vi.fn(async () => ({ ok: true as const }));
    const result = await runRedeploy({
      env: "prod",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    expect(result.exitCode).toBe(0);
  });

  it("reports zero failures with empty failure list in summary", async () => {
    const redeploy = vi.fn(async () => ({ ok: true as const }));
    await runRedeploy({ env: "staging", redeploy, appendSummary });
    expect(summary).toMatch(/0 failed/);
  });

  it("throws on a --services entry that doesn't resolve to a known SSOT key", async () => {
    const redeploy = vi.fn();
    await expect(
      runRedeploy({
        env: "staging",
        redeploy,
        appendSummary,
        services: ["nonsense"],
      }),
    ).rejects.toThrow(/Unknown service/);
    expect(redeploy).not.toHaveBeenCalled();
  });

  it("rejects unknown env names", async () => {
    const redeploy = vi.fn();
    await expect(
      runRedeploy({ env: "dev" as never, redeploy, appendSummary }),
    ).rejects.toThrow(/Unknown env/);
    expect(redeploy).not.toHaveBeenCalled();
  });
});

describe("resolveTargetServices", () => {
  it("accepts SSOT keys verbatim and resolves CI dispatch_names too", () => {
    // The workflow passes detect-changes.outputs.matrix .dispatch_name
    // values, but a human operator might pass SSOT keys directly.
    // Both forms must resolve.
    const resolved = resolveTargetServices([
      "showcase-mastra", // already an SSOT key
      "mastra", // dispatch_name → showcase-mastra
      "shell-dashboard", // dispatch_name → dashboard
      "showcase-aimock", // dispatch_name → aimock
    ]);
    expect(resolved).toEqual(["showcase-mastra", "dashboard", "aimock"]);
    // Dedupes the duplicate showcase-mastra ↔ mastra.
  });

  it("throws on inputs that match neither SSOT keys nor dispatch_names", () => {
    expect(() => resolveTargetServices(["mastra", "garbage"])).toThrow(
      /Unknown service "garbage"/,
    );
  });

  it("returns the CI_BUILT_SERVICES set sorted when given undefined", () => {
    const resolved = resolveTargetServices(undefined);
    expect(resolved.length).toBe(26);
    // pocketbase is now CI-built and part of the default scope.
    expect(resolved).toContain("pocketbase");
    // webhooks remains out-of-band.
    expect(resolved).not.toContain("webhooks");
  });
});

describe("expandImageConsumers", () => {
  it("adds imageOf consumers of a built service for staging", () => {
    expect(expandImageConsumers(["harness"], "staging")).toEqual([
      "harness",
      "harness-workers",
    ]);
  });

  it("excludes consumers that do not declare the target env (prod)", () => {
    // harness-workers is staging-only; a prod redeploy of harness must not
    // attempt the worker.
    expect(expandImageConsumers(["harness"], "prod")).toEqual(["harness"]);
  });

  it("returns the input unchanged for services without consumers", () => {
    expect(
      expandImageConsumers(["showcase-mastra", "aimock"], "staging"),
    ).toEqual(["showcase-mastra", "aimock"]);
  });

  it("does not duplicate a consumer that is already in the input", () => {
    expect(
      expandImageConsumers(["harness", "harness-workers"], "staging"),
    ).toEqual(["harness", "harness-workers"]);
  });
});

describe("parseArgs", () => {
  it("parses bare env name", () => {
    expect(parseArgs(["staging"])).toEqual({ env: "staging" });
  });

  it("parses --services with CSV value", () => {
    expect(parseArgs(["staging", "--services", "mastra,ag2"])).toEqual({
      env: "staging",
      services: ["mastra", "ag2"],
    });
  });

  it("parses --services=csv form", () => {
    expect(parseArgs(["staging", "--services=mastra,ag2"])).toEqual({
      env: "staging",
      services: ["mastra", "ag2"],
    });
  });

  it("throws when --services has no following value (bare flag at end)", () => {
    expect(() => parseArgs(["staging", "--services"])).toThrow(
      /--services requires a non-empty comma-separated value/,
    );
  });

  it("throws when --services value is the empty string", () => {
    expect(() => parseArgs(["staging", "--services", ""])).toThrow(
      /--services requires a non-empty comma-separated value/,
    );
  });

  it("throws when --services value is only commas/whitespace", () => {
    expect(() => parseArgs(["staging", "--services", ","])).toThrow(
      /--services requires a non-empty comma-separated value/,
    );
  });

  it("throws when --services= value empties after split/filter", () => {
    expect(() => parseArgs(["staging", "--services="])).toThrow(
      /--services requires a non-empty comma-separated value/,
    );
  });

  it("throws on unknown argument", () => {
    expect(() => parseArgs(["staging", "--bogus"])).toThrow(/Unknown argument/);
  });

  it("throws on empty argv", () => {
    expect(() => parseArgs([])).toThrow();
  });
});
