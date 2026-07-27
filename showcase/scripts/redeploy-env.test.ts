import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expandImageConsumers,
  makeLiveRedeploy,
  parseArgs,
  runRedeploy,
  resolveTargetServices,
} from "./redeploy-env";
import {
  ENV_IDS,
  ENV_ID_BY_NAME,
  PRODUCTION_ENV_ID,
  SERVICES,
} from "./railway-envs";

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

  it("default staging scope = 39 CI-built services + their imageOf consumers (harness-workers)", async () => {
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
    // 39 CI-built (27 showcase/infra incl. showcase-strands-typescript,
    // now dual-env, + 12 starters) + harness-workers (imageOf consumer of
    // showcase-harness) = 40. All 39 declare staging, so the env-aware
    // default scope keeps every one of them.
    expect(result.attempted).toBe(40);
    expect(result.succeeded).toBe(40);
    expect(redeploy).toHaveBeenCalledTimes(40);
    // pocketbase is now CI-built, so it IS in the default redeploy scope.
    expect(seenNames).toContain("pocketbase");
    // The TypeScript Strands integration declares staging, so it IS in the
    // staging default scope (and now prod too — see below).
    expect(seenNames).toContain("showcase-strands-typescript");
    // S2: starters are CI-built, so they JOIN the default redeploy scope.
    expect(seenNames).toContain("starter-adk");
    expect(seenNames).toContain("starter-mastra");
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

  it("CONTRACT PIN: an explicitly-named service is attempted even in an env it does not declare (harness-workers on prod)", async () => {
    // Documented in the header: the env filter applies ONLY to consumers
    // added by imageOf expansion — a service the caller explicitly names
    // in --services is attempted even in an env it does not declare.
    // harness-workers is staging-only, yet an explicit prod request must
    // still fire against the prod env id. If a future "cleanup"
    // env-filters explicit requests, this test fails loudly against that
    // documented contract; change the docs AND this pin together or not
    // at all.
    const calls: Array<{ serviceId: string; environmentId: string }> = [];
    const redeploy = vi.fn(async (serviceId: string, environmentId: string) => {
      calls.push({ serviceId, environmentId });
      return { ok: true as const };
    });
    const result = await runRedeploy({
      env: "prod",
      redeploy,
      appendSummary,
      services: ["harness-workers"],
    });
    expect(result.attempted).toBe(1);
    expect(calls).toEqual([
      {
        serviceId: SERVICES["harness-workers"].serviceId,
        environmentId: PRODUCTION_ENV_ID,
      },
    ]);
  });

  it("default prod scope includes the dual-env worker (harness-workers) and dual-env showcase-strands-typescript", async () => {
    // The default scope is env-aware: a service joins the prod scope when it
    // declares a prod env. harness-workers is now dual-env (the prod worker was
    // backfilled into the SSOT), so the env-aware imageOf expansion pulls it
    // into the prod scope as a showcase-harness consumer. showcase-strands-typescript
    // is also dual-env and joins. The prod default = the 40 services that
    // declare prod (27 CI-built showcase/infra incl. showcase-strands-typescript
    // + 12 starters + the imageOf-consumer harness-workers).
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
    expect(result.attempted).toBe(40);
    // harness-workers is now dual-env, so a prod redeploy of its showcase-harness
    // image bounces the prod worker too (it used to be silently skipped).
    expect(seenNames).toContain("harness-workers");
    // showcase-strands-typescript is dual-env, so it joins the prod scope.
    expect(seenNames).toContain("showcase-strands-typescript");
    // S2: starters ARE in the default prod scope (CI-built, dual-env).
    expect(seenNames).toContain("starter-adk");
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

  it("a registered NON-staging third env gets fail-loud semantics (exit 1 on per-service failure)", async () => {
    // Exit-code policy is fail-loud by DEFAULT: staging is the single
    // documented carve-out (non-fatal; verify-deploy is its gate). A future
    // "preview" env must inherit prod-style fatal semantics without anyone
    // remembering to extend an env allowlist.
    ENV_ID_BY_NAME.preview = "preview-env-id-000";
    try {
      const redeploy = vi.fn(async () => ({
        ok: false as const,
        error: "boom",
      }));
      const result = await runRedeploy({
        env: "preview",
        redeploy,
        appendSummary,
        services: ["showcase-mastra"],
      });
      expect(result.failed).toBe(1);
      expect(result.exitCode).toBe(1);
      // The "non-fatal" summary note is staging-only — a fatal env must
      // not claim its failures are non-fatal.
      expect(summary).not.toMatch(/non-fatal/);
    } finally {
      delete ENV_ID_BY_NAME.preview;
    }
  });

  it("staging keeps the non-fatal note in the failure summary (the documented carve-out)", async () => {
    const redeploy = vi.fn(async () => ({
      ok: false as const,
      error: "boom",
    }));
    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    expect(result.exitCode).toBe(0);
    expect(summary).toMatch(/non-fatal/);
  });

  it("sanitizes per-service THROWN error messages through sanitizeErrorBody", async () => {
    // The non-throw FAIL path gets pre-sanitized errors from
    // makeLiveRedeploy, but a rejection thrown by the redeploy fn (e.g. an
    // AbortSignal timeout wrapping a Cloudflare HTML page) bypassed that —
    // the raw message landed in the records + markdown summary.
    const redeploy = vi.fn(async () => {
      throw new Error(`boom <script>\nline2 ${"x".repeat(300)}`);
    });
    const result = await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    expect(result.failed).toBe(1);
    expect(summary).not.toMatch(/<script>/);
    expect(summary).toMatch(/boom scriptline2/);
    // Capped at 200 chars with the sanitizer's ellipsis.
    expect(summary).toMatch(/…/);
  });

  it("strips bare carriage returns (no \\n) from the summary table row", async () => {
    const redeploy = vi.fn(async () => ({
      ok: false as const,
      error: "part1\rpart2",
    }));
    await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    expect(summary).toMatch(/part1 part2/);
    expect(summary).not.toMatch(/\r/);
  });

  it("warns to stderr when REDEPLOY_SUMMARY_JSON is set but empty", async () => {
    // An empty-string REDEPLOY_SUMMARY_JSON silently disabled the JSON
    // summary (falsy check) — the CI consumer then saw "no artifact" with
    // zero signal about why. Warn loudly; still skip the write.
    vi.stubEnv("REDEPLOY_SUMMARY_JSON", "");
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const redeploy = vi.fn(async () => ({ ok: true as const }));
      await runRedeploy({
        env: "staging",
        redeploy,
        appendSummary,
        services: ["showcase-mastra"],
      });
      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).toMatch(/REDEPLOY_SUMMARY_JSON is set but empty/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("warns to stderr when REDEPLOY_SUMMARY_JSON is whitespace-only (trimmed before the set-but-empty check)", async () => {
    // A whitespace-only value is exactly as unusable as the empty string,
    // but without trimming it is truthy — it would skip the loud warn and
    // attempt a JSON write against a garbage path instead.
    vi.stubEnv("REDEPLOY_SUMMARY_JSON", "   \n\t");
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const redeploy = vi.fn(async () => ({ ok: true as const }));
      await runRedeploy({
        env: "staging",
        redeploy,
        appendSummary,
        services: ["showcase-mastra"],
      });
      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).toMatch(/REDEPLOY_SUMMARY_JSON is set but empty/);
    } finally {
      stderrSpy.mockRestore();
    }
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
    expect(summary).toMatch(/- failed: \*\*0\*\*/);
  });

  it("flattens CRLF newlines in failure errors to keep the markdown table on one row", async () => {
    const redeploy = vi.fn(async () => ({
      ok: false as const,
      error: "line one\r\nline two",
    }));
    await runRedeploy({
      env: "staging",
      redeploy,
      appendSummary,
      services: ["showcase-mastra"],
    });
    expect(summary).toMatch(/line one line two/);
    expect(summary).not.toMatch(/\r/);
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
      runRedeploy({ env: "dev", redeploy, appendSummary }),
    ).rejects.toThrow(/Unknown env/);
    expect(redeploy).not.toHaveBeenCalled();
  });

  it("rejects an unnormalized env synonym, pointing at resolveEnv", async () => {
    // "production" is a resolveEnv synonym, not a registered SSOT env key.
    // runRedeploy must resolve env ids via the registry (open-env
    // contract), so the synonym fails loud with a normalization hint.
    const redeploy = vi.fn();
    await expect(
      runRedeploy({ env: "production", redeploy, appendSummary }),
    ).rejects.toThrow(/Unknown env "production".*resolveEnv/);
    expect(redeploy).not.toHaveBeenCalled();
  });

  it("resolves the env id via the ENV_ID_BY_NAME registry (open-env contract)", async () => {
    // The SSOT's documented contract: a new env needs only a registry
    // entry — runRedeploy must NOT hardcode the prod/staging pair.
    // Register a hypothetical env and verify the redeploy fires against
    // its registered env id.
    ENV_ID_BY_NAME.preview = "preview-env-id-000";
    try {
      const calls: Array<{ environmentId: string }> = [];
      const redeploy = vi.fn(async (_svc: string, environmentId: string) => {
        calls.push({ environmentId });
        return { ok: true as const };
      });
      const result = await runRedeploy({
        env: "preview",
        redeploy,
        appendSummary,
        // Explicitly-named services are attempted even in an env they do
        // not declare (the documented contract pinned above).
        services: ["showcase-mastra"],
      });
      expect(result.attempted).toBe(1);
      expect(calls).toEqual([{ environmentId: "preview-env-id-000" }]);
    } finally {
      delete ENV_ID_BY_NAME.preview;
    }
  });

  it("throws when an explicitly-provided services list resolves to zero entries", async () => {
    // A provided-but-all-blank list silently redeploying NOTHING with
    // exit 0 is the silent-no-op class this script's header forbids.
    const redeploy = vi.fn();
    await expect(
      runRedeploy({
        env: "staging",
        redeploy,
        appendSummary,
        services: ["  ", ""],
      }),
    ).rejects.toThrow(/resolved to zero services/);
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

  it("rejects inherited Object.prototype keys as unknown services", () => {
    // `SERVICES[name]` with name "toString" resolves to the inherited
    // Object.prototype method — a truthy non-entry. The lookup must use
    // an own-property check, or a prototype key sails through as a
    // "valid" service whose entry.serviceId is undefined downstream,
    // violating the header's "unknown service ALWAYS fails loud" contract.
    expect(() => resolveTargetServices(["toString"])).toThrow(
      /Unknown service "toString"/,
    );
    expect(() => resolveTargetServices(["constructor"])).toThrow(
      /Unknown service "constructor"/,
    );
    expect(() => resolveTargetServices(["hasOwnProperty"])).toThrow(
      /Unknown service "hasOwnProperty"/,
    );
  });

  it("returns the CI_BUILT_SERVICES set sorted when given undefined", () => {
    const resolved = resolveTargetServices(undefined);
    // 27 showcase/infra CI-built (incl. showcase-strands-typescript) + 12
    // starters = 39. resolveTargetServices returns the FULL CI_BUILT set;
    // the env-aware narrowing happens later in runRedeploy, not here.
    expect(resolved.length).toBe(39);
    // pocketbase is now CI-built and part of the default scope.
    expect(resolved).toContain("pocketbase");
    // S2: starters are CI-built and part of the default scope.
    expect(resolved).toContain("starter-adk");
    // webhooks remains out-of-band.
    expect(resolved).not.toContain("webhooks");
  });

  it("throws when a provided list resolves empty instead of silently no-opping", () => {
    // parseArgs already rejects empty CSV at the CLI boundary; this guards
    // the programmatic path (e.g. a caller passing whitespace-only entries)
    // so an explicit request can never resolve to a zero-service no-op.
    expect(() => resolveTargetServices([""])).toThrow(
      /resolved to zero services/,
    );
    expect(() => resolveTargetServices(["  ", "\t"])).toThrow(
      /resolved to zero services/,
    );
  });
});

describe("makeLiveRedeploy", () => {
  afterEach(() => {
    // restoreAllMocks does NOT undo stubGlobal — unstub explicitly or the
    // fetch stub leaks into other files under fork reuse.
    vi.unstubAllGlobals();
  });

  function stubFetch(
    impl: (url: unknown, init?: RequestInit) => Promise<unknown>,
  ) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("passes an abort signal so a hung Railway API records a per-service FAIL", async () => {
    // Without a timeout signal a hung Railway API stalls the CI job until
    // the runner's global timeout; the AbortSignal rejection is caught by
    // runRedeploy's per-service try/catch and recorded as FAIL instead.
    let capturedInit: RequestInit | undefined;
    stubFetch(async (_url, init) => {
      capturedInit = init;
      return {
        ok: true,
        json: async () => ({ data: { serviceInstanceRedeploy: true } }),
      };
    });
    const redeploy = makeLiveRedeploy("test-token");
    const outcome = await redeploy("svc-id", "env-id");
    expect(outcome).toEqual({ ok: true });
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sanitizes GraphQL errors[].message through sanitizeErrorBody", async () => {
    // Consistency with the HTTP-error path: GraphQL error strings can be
    // multi-KB / markdown-breaking too. Angle brackets + newlines must be
    // stripped and long messages capped (200 chars + ellipsis).
    stubFetch(async () => ({
      ok: true,
      json: async () => ({
        errors: [
          { message: "boom <script>\nline2" },
          { message: "x".repeat(250) },
        ],
      }),
    }));
    const redeploy = makeLiveRedeploy("test-token");
    const outcome = await redeploy("svc-id", "env-id");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBe(`boom scriptline2; ${"x".repeat(200)}…`);
    }
  });

  it("returns a sanitized HTTP-status failure when the response is not ok", async () => {
    // Non-2xx path: the body (often a multi-KB Cloudflare HTML page) must
    // go through sanitizeErrorBody — no angle brackets, no newlines, capped.
    stubFetch(async () => ({
      ok: false,
      status: 503,
      text: async () =>
        `<html>\nCloudflare error page</html>${"y".repeat(300)}`,
    }));
    const redeploy = makeLiveRedeploy("test-token");
    const outcome = await redeploy("svc-id", "env-id");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/^HTTP 503: /);
      expect(outcome.error).not.toMatch(/[<>\n]/);
      expect(outcome.error).toMatch(/…$/);
    }
  });

  it("fails when serviceInstanceRedeploy returns a non-true value", async () => {
    // A 200 response whose mutation result is false/undefined is NOT a
    // success — Railway acknowledged the call but did not redeploy.
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ data: { serviceInstanceRedeploy: false } }),
    }));
    const redeploy = makeLiveRedeploy("test-token");
    const outcome = await redeploy("svc-id", "env-id");
    expect(outcome).toEqual({
      ok: false,
      error: "serviceInstanceRedeploy returned false",
    });

    stubFetch(async () => ({
      ok: true,
      json: async () => ({ data: {} }),
    }));
    const outcome2 = await makeLiveRedeploy("test-token")("svc-id", "env-id");
    expect(outcome2).toEqual({
      ok: false,
      error: "serviceInstanceRedeploy returned undefined",
    });
  });
});

describe("expandImageConsumers", () => {
  it("adds imageOf consumers of a built service for staging", () => {
    expect(expandImageConsumers(["harness"], "staging")).toEqual([
      "harness",
      "harness-workers",
    ]);
  });

  it("includes a dual-env consumer (harness-workers) in the prod expansion", () => {
    // harness-workers is now dual-env (the prod worker was backfilled into the
    // SSOT), so a prod redeploy of its showcase-harness image MUST also bounce
    // the prod worker — the env-aware expansion pulls it in for prod just like
    // staging. (The env-aware EXCLUSION branch — skipping a consumer that does
    // not declare the target env — is exercised by expandImageConsumers' own
    // Object.hasOwn(entry.environments, env) guard; there is no longer a
    // single-env imageOf consumer in the SSOT to demonstrate it end-to-end.)
    expect(expandImageConsumers(["harness"], "prod")).toEqual([
      "harness",
      "harness-workers",
    ]);
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

  it("throws on an unnormalized env synonym instead of silently not expanding", () => {
    // "production" is a resolveEnv synonym, NOT an SSOT `environments` key.
    // A silent no-expansion here would recreate the exact stale-image class
    // this function exists to prevent (harness-workers left running a stale
    // image because the env string didn't match any `environments` key).
    expect(() => expandImageConsumers(["harness"], "production")).toThrow(
      /Unknown env "production".*resolveEnv/,
    );
  });

  it("throws on an inherited prototype key as env instead of silently not expanding", () => {
    // The registry own-key validation rejects a prototype-named env up
    // front, and the per-entry skip-check is itself an own-property test
    // (`Object.hasOwn(entry.environments, env)`), so even a registered
    // prototype-named env could not match a truthy inherited value.
    expect(() => expandImageConsumers(["harness"], "constructor")).toThrow(
      /Unknown env "constructor"/,
    );
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

  it("throws on duplicate --services flags (either form, mixed too)", () => {
    expect(() =>
      parseArgs(["staging", "--services", "mastra", "--services", "ag2"]),
    ).toThrow(/Duplicate --services/);
    expect(() =>
      parseArgs(["staging", "--services=mastra", "--services=ag2"]),
    ).toThrow(/Duplicate --services/);
    expect(() =>
      parseArgs(["staging", "--services", "mastra", "--services=ag2"]),
    ).toThrow(/Duplicate --services/);
  });

  it("throws when --services is followed by a flag-like token instead of a value", () => {
    // Without this guard, `--services --bogus` would swallow `--bogus` as
    // the CSV — a silent misparse instead of a loud operator error.
    expect(() => parseArgs(["staging", "--services", "--bogus"])).toThrow(
      /--services requires a value/,
    );
    expect(() => parseArgs(["staging", "--services", "-x"])).toThrow(
      /--services requires a value/,
    );
  });

  it("throws on unknown argument", () => {
    expect(() => parseArgs(["staging", "--bogus"])).toThrow(/Unknown argument/);
  });

  it("throws on empty argv", () => {
    expect(() => parseArgs([])).toThrow();
  });

  it("rejects flag-like entries inside the --services CSV (both forms)", () => {
    // The space form already rejects a flag-like NEXT TOKEN; the = form and
    // individual CSV parts had no such guard, so `--services=--bogus`
    // silently became a service name destined for an Unknown-service throw
    // far from the CLI boundary.
    expect(() => parseArgs(["staging", "--services=--bogus"])).toThrow(
      /flag-like/,
    );
    expect(() => parseArgs(["staging", "--services", "mastra,-x"])).toThrow(
      /flag-like/,
    );
    expect(() => parseArgs(["staging", "--services=mastra,--force"])).toThrow(
      /flag-like/,
    );
  });

  it("rejects a flag-like first argument as a missing env argument", () => {
    // `redeploy-env.ts --services mastra` forgot the env — the old parse
    // consumed "--services" AS the env and failed later/elsewhere.
    expect(() => parseArgs(["--services", "mastra"])).toThrow(
      /missing env argument/i,
    );
    expect(() => parseArgs(["-h"])).toThrow(/missing env argument/i);
  });

  it("derives the usage env list from ENV_IDS (a registered spelling appears with no code change)", () => {
    // Open-env contract at the CLI boundary: the usage string must list
    // whatever ENV_IDS currently accepts, not a hardcoded triple.
    ENV_IDS.preview = "preview-env-id-000";
    try {
      expect(() => parseArgs([])).toThrow(/preview/);
    } finally {
      delete ENV_IDS.preview;
    }
  });
});
