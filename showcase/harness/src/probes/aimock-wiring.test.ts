import { describe, it, expect } from "vitest";
import { aimockWiringProbe, SEALED_SENTINEL } from "./aimock-wiring.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };
const AIMOCK_URL = "https://showcase-aimock-production.up.railway.app";

describe("aimock-wiring probe", () => {
  it("returns green when every LLM-calling service routes through aimock", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-sales-dashboard" },
          { name: "showcase-quickstart" },
          { name: "showcase-aimock" },
        ],
        getServiceEnv: async (name) => {
          if (name === "showcase-sales-dashboard")
            return { OPENAI_BASE_URL: AIMOCK_URL };
          if (name === "showcase-quickstart")
            return { OPENAI_BASE_URL: AIMOCK_URL };
          return {};
        },
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wiredCount).toBe(2);
    expect(r.signal.erroredCount).toBe(0);
    expect(r.key).toBe("aimock_wiring:global");
  });

  it("returns red with unwired services listed when OPENAI_BASE_URL is missing", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-sales-dashboard" },
          { name: "showcase-quickstart" },
        ],
        getServiceEnv: async (name) =>
          name === "showcase-sales-dashboard"
            ? { OPENAI_BASE_URL: AIMOCK_URL }
            : {},
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual(["showcase-quickstart"]);
    expect(r.signal.unwiredCount).toBe(1);
    expect(r.signal.unwiredNoun).toBe("service");
  });

  it("pluralizes unwiredNoun with multiple unwired services and returns sorted output", async () => {
    // NOTE: input order is deliberately [dashboard, quickstart]; probe output
    // must be lexically sorted regardless of listServices order.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-sales-dashboard" },
          { name: "showcase-quickstart" },
        ],
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual([
      "showcase-quickstart",
      "showcase-sales-dashboard",
    ]);
    expect(r.signal.unwiredCount).toBe(2);
    expect(r.signal.unwiredNoun).toBe("services");
  });

  it("flags a service whose base URL points elsewhere (not aimock)", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-sales-dashboard" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: "https://api.openai.com/v1",
        }),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual(["showcase-sales-dashboard"]);
  });

  it("excludes aimock / shell / pocketbase services from the check (exact name match)", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-aimock" },
          { name: "showcase-shell" },
          { name: "showcase-shell-dashboard" },
          { name: "showcase-shell-docs" },
          { name: "showcase-pocketbase" },
          { name: "showcase-harness" },
        ],
        // None of these have aimock base URLs — but all should be excluded.
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wiredCount).toBe(0);
  });

  it("excludes BARE-named Railway infra services (no `showcase-` prefix)", async () => {
    // Regression: actual deployed Railway service names are bare
    // (`harness`, `shell`, `dashboard`, `docs`, `dojo`, `pocketbase`,
    // `webhooks`, `aimock`) but EXCLUDE_SERVICES only listed the
    // `showcase-`-prefixed form, so the probe counted all infra services
    // as unwired and went red on staging/prod despite aimock being
    // correctly wired. Both forms must be treated as excluded.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "aimock" },
          { name: "harness" },
          { name: "shell" },
          { name: "dashboard" },
          { name: "docs" },
          { name: "dojo" },
          { name: "pocketbase" },
          { name: "webhooks" },
        ],
        // None of these have aimock base URLs — all are non-LLM infra
        // and must be excluded regardless of bare-vs-prefixed naming.
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wiredCount).toBe(0);
  });

  it("checks ms-agent-harness-dotnet for aimock wiring (no longer excluded)", async () => {
    // The column is now fully probe-wired (d6/d4 aimock fixtures shipped via
    // PR #5569), so it is an LLM caller and must route through aimock like any
    // other partner. Unwired → red; wired (base URL present) → green.
    const unwired = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "ms-agent-harness-dotnet" }],
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(unwired.state).toBe("red");
    expect(unwired.signal.unwired).toEqual(["ms-agent-harness-dotnet"]);

    const wired = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "ms-agent-harness-dotnet" }],
        getServiceEnv: async () => ({ ANTHROPIC_BASE_URL: AIMOCK_URL }),
      },
      ctx,
    );
    expect(wired.state).toBe("green");
    expect(wired.signal.unwired).toEqual([]);
    expect(wired.signal.wiredCount).toBe(1);
  });

  it("does NOT false-exclude services that merely share a prefix with infra names", async () => {
    // Regression: a prefix-based match on `showcase-aimock` would incorrectly
    // exclude `showcase-aimock-pinger-mock-for-test` (or any hypothetical
    // service whose name starts with an infra prefix). Exact match only.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-aimock-pinger-mock-for-test" },
          { name: "showcase-shell-something-else" },
        ],
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual([
      "showcase-aimock-pinger-mock-for-test",
      "showcase-shell-something-else",
    ]);
    expect(r.signal.unwiredCount).toBe(2);
  });

  it("accepts ANTHROPIC_BASE_URL as an alternative (claude-sdk pattern)", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-claude-sdk" }],
        getServiceEnv: async () => ({ ANTHROPIC_BASE_URL: AIMOCK_URL }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wiredCount).toBe(1);
  });

  it("deduplicates services listed more than once by Railway API", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-sales-dashboard" },
          { name: "showcase-sales-dashboard" },
        ],
        getServiceEnv: async () => ({ OPENAI_BASE_URL: AIMOCK_URL }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wiredCount).toBe(1);
  });

  it("normalizes URL: trailing slash equivalent to no slash", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-sales-dashboard" }],
        // Env has trailing slash; probe URL does not — should still match.
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: `${AIMOCK_URL}/`,
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wiredCount).toBe(1);
  });

  it("normalizes URL: case-insensitive hostname compare", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-sales-dashboard" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: AIMOCK_URL.replace(
            "showcase-aimock",
            "SHOWCASE-AIMOCK",
          ),
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wiredCount).toBe(1);
  });

  it("normalizes URL: query string and fragment are ignored", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-sales-dashboard" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: `${AIMOCK_URL}?env=prod#anchor`,
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wiredCount).toBe(1);
  });

  it("normalizes URL: default http :80 and https :443 ports collapse to implicit form", async () => {
    // Declare two services so both default-port variants are exercised in
    // one run without crossing protocols on the aimock URL itself.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: "https://aimock.example",
        listServices: async () => [{ name: "s-explicit-443" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: "https://aimock.example:443",
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wiredCount).toBe(1);

    const r2 = await aimockWiringProbe.run(
      {
        aimockUrl: "http://aimock.example",
        listServices: async () => [{ name: "s-explicit-80" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: "http://aimock.example:80",
        }),
      },
      ctx,
    );
    expect(r2.state).toBe("green");
    expect(r2.signal.wiredCount).toBe(1);
  });

  it("matches the PRIVATE Railway networking host (egress fix): internal aimockUrl vs :4010/v1 base URLs go green", async () => {
    // Egress fix: demo backends route LLM traffic at aimock over free private
    // networking (http://showcase-aimock.railway.internal:4010) instead of the
    // billed public *.up.railway.app host. The probe matches on HOSTNAME only,
    // so the harness AIMOCK_URL (bare internal origin) and the demo backends'
    // OPENAI_BASE_URL (internal host + :4010 port + /v1 suffix) resolve to the
    // same hostname `showcase-aimock.railway.internal` and the probe stays
    // green. Locks in that the private-host migration keeps wiring green.
    const INTERNAL_AIMOCK = "http://showcase-aimock.railway.internal:4010";
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: INTERNAL_AIMOCK,
        listServices: async () => [
          { name: "showcase-ag2" },
          { name: "showcase-claude-sdk-python" },
          { name: "showcase-google-adk" },
        ],
        getServiceEnv: async (name) => {
          if (name === "showcase-ag2")
            return {
              OPENAI_BASE_URL:
                "http://showcase-aimock.railway.internal:4010/v1",
            };
          if (name === "showcase-claude-sdk-python")
            return {
              ANTHROPIC_BASE_URL:
                "http://showcase-aimock.railway.internal:4010",
            };
          return {
            GOOGLE_GEMINI_BASE_URL:
              "http://showcase-aimock.railway.internal:4010",
          };
        },
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wiredCount).toBe(3);
    expect(r.signal.erroredCount).toBe(0);
  });

  it("flags a demo still on the PUBLIC aimock host when the harness is on the PRIVATE host (egress drift)", async () => {
    // With the harness AIMOCK_URL migrated to the private host, a demo backend
    // still pointing at the public *.up.railway.app aimock host is egress
    // drift — different hostname → unwired → red. This is the signal that a
    // backend missed the private-networking flip.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: "http://showcase-aimock.railway.internal:4010",
        listServices: async () => [{ name: "showcase-ag2" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL:
            "https://showcase-aimock-production.up.railway.app/v1",
        }),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual(["showcase-ag2"]);
  });

  it("isolates per-service env-fetch failures to the errored bucket", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-broken" },
          { name: "showcase-sales-dashboard" },
        ],
        getServiceEnv: async (name) => {
          if (name === "showcase-broken") {
            throw new Error("Railway API 500");
          }
          return { OPENAI_BASE_URL: AIMOCK_URL };
        },
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.wired).toEqual(["showcase-sales-dashboard"]);
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.errored).toHaveLength(1);
    expect(r.signal.errored[0]).toMatchObject({
      name: "showcase-broken",
      errorDesc: "Railway API 500",
    });
    expect(r.signal.erroredCount).toBe(1);
    expect(r.signal.hasErrored).toBe(true);
    expect(r.signal.erroredPreview).toEqual([
      "showcase-broken: Railway API 500",
    ]);
  });

  it("caps erroredPreview at 5 entries and appends (+N more)", async () => {
    // Regression: templates used to only see `erroredCount`, forcing operators
    // to log-dive. Inline preview keeps context without unbounded message
    // growth.
    const names = Array.from({ length: 7 }, (_, i) => `svc-${i}`);
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => names.map((name) => ({ name })),
        getServiceEnv: async (name) => {
          throw new Error(`boom for ${name}`);
        },
      },
      ctx,
    );
    expect(r.signal.erroredCount).toBe(7);
    expect(r.signal.erroredPreview).toHaveLength(6); // 5 names + "(+2 more)"
    expect(r.signal.erroredPreview[0]).toBe("svc-0: boom for svc-0");
    expect(r.signal.erroredPreview[4]).toBe("svc-4: boom for svc-4");
    expect(r.signal.erroredPreview[5]).toBe("(+2 more)");
    expect(r.signal.hasErrored).toBe(true);
  });

  it("unwiredNoun singular when exactly one service is unwired", async () => {
    // F4.4 red-green: count=1 must read "service", not "services". Already
    // covered above indirectly; this test locks the singular contract
    // explicitly for count=1 so a regression to `count > 0 ? services : service`
    // would be caught immediately.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "lonely-service" }],
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(r.signal.unwiredCount).toBe(1);
    expect(r.signal.unwiredNoun).toBe("service");
  });

  it("F4.2 sealed env: SEALED_SENTINEL in OPENAI_BASE_URL → sealed bucket, NOT unwired", async () => {
    // Regression: Railway-masked values surfaced as undefined by the adapter
    // were conflated with "not wired" and fired false drift. The adapter now
    // passes SEALED_SENTINEL, and the probe routes that to a sealed bucket
    // that does NOT trip red.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "svc-sealed" },
          { name: "svc-wired" },
        ],
        getServiceEnv: async (name) =>
          name === "svc-sealed"
            ? { OPENAI_BASE_URL: SEALED_SENTINEL }
            : { OPENAI_BASE_URL: AIMOCK_URL },
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.sealed).toEqual(["svc-sealed"]);
    expect(r.signal.sealedCount).toBe(1);
    expect(r.signal.hasSealed).toBe(true);
    expect(r.signal.sealedPreview).toEqual(["svc-sealed"]);
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wired).toEqual(["svc-wired"]);
  });

  it("F4.2 sealed env: a confirmed match on ANOTHER candidate var beats a sealed sibling", async () => {
    // If ANTHROPIC_BASE_URL is a confirmed aimock match, a sealed
    // OPENAI_BASE_URL must not demote the service to sealed — it's wired.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "svc-mixed" }],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: SEALED_SENTINEL,
          ANTHROPIC_BASE_URL: AIMOCK_URL,
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wired).toEqual(["svc-mixed"]);
    expect(r.signal.sealed).toEqual([]);
    expect(r.signal.unwired).toEqual([]);
  });

  it("F4.2 sealed env: sealedPreview caps at 5 with (+N more) overflow", async () => {
    const names = Array.from({ length: 7 }, (_, i) => `s-${i}`);
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => names.map((name) => ({ name })),
        getServiceEnv: async () => ({ OPENAI_BASE_URL: SEALED_SENTINEL }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.sealedCount).toBe(7);
    expect(r.signal.sealedPreview).toHaveLength(6);
    expect(r.signal.sealedPreview[5]).toBe("(+2 more)");
  });

  it("F4.2 sealed + errored: sealed does not trip red, errored does", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "svc-sealed" },
          { name: "svc-errored" },
        ],
        getServiceEnv: async (name) => {
          if (name === "svc-sealed")
            return { OPENAI_BASE_URL: SEALED_SENTINEL };
          throw new Error("Railway 500");
        },
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.sealed).toEqual(["svc-sealed"]);
    expect(r.signal.errored).toHaveLength(1);
    expect(r.signal.hasSealed).toBe(true);
    expect(r.signal.hasErrored).toBe(true);
  });

  it("HF13-C1: malformed aimockUrl emits probeErrored + config-error entry in errored (no per-service iteration)", async () => {
    // Regression: when AIMOCK_BASE_URL is unparseable, the probe used to fall
    // through `normalizeUrl -> null` and mark every service as mismatch,
    // firing a spurious "all services drifted" alert. The correct behavior is
    // to short-circuit with a config-error sentinel in `errored` so
    // `deriveSignalFlags` emits `set_errored` and the aimock-wiring-drift rule
    // renders the errored branch — NOT the drift branch.
    let getServiceEnvCalls = 0;
    let listServicesCalls = 0;
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: "not a url",
        listServices: async () => {
          listServicesCalls += 1;
          return [
            { name: "showcase-sales-dashboard" },
            { name: "showcase-quickstart" },
          ];
        },
        getServiceEnv: async () => {
          getServiceEnvCalls += 1;
          return {};
        },
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.probeErrored).toBe(true);
    expect(r.signal.probeErrorDesc).toBe("aimockUrl parse failed: not a url");
    expect(r.signal.configError).toBe(true);
    expect(r.signal.hasErrored).toBe(true);
    expect(r.signal.erroredCount).toBe(1);
    expect(r.signal.errored).toEqual([
      { name: "<config>", errorDesc: "aimockUrl parse failed: not a url" },
    ]);
    expect(r.signal.erroredPreview).toEqual([
      "<config>: aimockUrl parse failed: not a url",
    ]);
    // Per-service iteration must NOT run — services would all be falsely
    // reported as `mismatch` if we iterated against a null target.
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wired).toEqual([]);
    expect(r.signal.sealed).toEqual([]);
    expect(getServiceEnvCalls).toBe(0);
    // listServices is allowed to run (needed for excluded filtering would add
    // noise); assert it didn't iterate services either by checking env wasn't
    // fetched. We don't constrain listServices itself because the contract is
    // "no per-service env lookups", not "skip listServices".
    expect(listServicesCalls).toBeLessThanOrEqual(1);
  });

  it("HF13-C1: well-formed probe runs carry probeErrored=false + configError=false", async () => {
    // Lock the default shape so downstream consumers can rely on the fields
    // always being present (redirect-decommission already establishes this
    // convention).
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-sales-dashboard" }],
        getServiceEnv: async () => ({ OPENAI_BASE_URL: AIMOCK_URL }),
      },
      ctx,
    );
    expect(r.signal.probeErrored).toBe(false);
    expect(r.signal.probeErrorDesc).toBe("");
    expect(r.signal.configError).toBe(false);
  });

  it("hasErrored is false when errored bucket is empty", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-sales-dashboard" }],
        getServiceEnv: async () => ({ OPENAI_BASE_URL: AIMOCK_URL }),
      },
      ctx,
    );
    expect(r.signal.hasErrored).toBe(false);
    expect(r.signal.erroredPreview).toEqual([]);
    expect(r.signal.hasSealed).toBe(false);
    expect(r.signal.sealed).toEqual([]);
    expect(r.signal.sealedPreview).toEqual([]);
    expect(r.signal.sealedCount).toBe(0);
  });

  it("wired when OPENAI_BASE_URL has /v1 path suffix and aimockUrl does not", async () => {
    // Most services set OPENAI_BASE_URL=<aimock>/v1 (OpenAI SDK convention)
    // while AIMOCK_URL is just the bare origin. The probe must match by
    // hostname so the /v1 path difference does not cause a false mismatch.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "showcase-ag2" },
          { name: "showcase-mastra" },
        ],
        getServiceEnv: async () => ({
          OPENAI_BASE_URL: `${AIMOCK_URL}/v1`,
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wired).toEqual(["showcase-ag2", "showcase-mastra"]);
    expect(r.signal.wiredCount).toBe(2);
    expect(r.signal.unwired).toEqual([]);
  });

  it("wired when GOOGLE_GEMINI_BASE_URL points at aimock", async () => {
    // showcase-google-adk uses GOOGLE_GEMINI_BASE_URL in addition to
    // OPENAI_BASE_URL. The probe must check all three candidate env vars.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-google-adk" }],
        getServiceEnv: async () => ({
          GOOGLE_GEMINI_BASE_URL: AIMOCK_URL,
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.wired).toEqual(["showcase-google-adk"]);
    expect(r.signal.wiredCount).toBe(1);
    expect(r.signal.unwired).toEqual([]);
  });

  it("GOOGLE_GEMINI_BASE_URL sealed → sealed bucket, not unwired", async () => {
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [{ name: "showcase-google-adk" }],
        getServiceEnv: async () => ({
          GOOGLE_GEMINI_BASE_URL: SEALED_SENTINEL,
        }),
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.sealed).toEqual(["showcase-google-adk"]);
    expect(r.signal.unwired).toEqual([]);
  });

  it("checks starters like any LLM backend (NOT excluded); infra stays excluded", async () => {
    // Starters route through aimock identically to showcase-* backends
    // (OPENAI_BASE_URL / ANTHROPIC_BASE_URL / GOOGLE_GEMINI_BASE_URL point at
    // aimock), so the probe MUST verify their wiring — `starter-*` services are
    // no longer excluded. Infra services (aimock/shell/…) remain excluded.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "starter-langgraph-python" }, // checked → wired
          { name: "starter-mastra" }, // checked → unwired
          { name: "aimock" }, // infra → still excluded
          { name: "shell" }, // infra → still excluded
        ],
        getServiceEnv: async (name) =>
          name === "starter-langgraph-python"
            ? { OPENAI_BASE_URL: AIMOCK_URL }
            : {},
      },
      ctx,
    );
    // Infra excluded, so it appears in neither bucket. The wired starter lands
    // in `wired`; the unwired one surfaces (and trips red) like any backend.
    expect(r.signal.wired).toEqual(["starter-langgraph-python"]);
    expect(r.signal.unwired).toEqual(["starter-mastra"]);
    expect(r.state).toBe("red");
  });

  it("excludes harness-workers (infra) but checks bare starter-* services", async () => {
    // Regression for the EXCLUDE drift: the live Railway roster carries
    // `harness-workers` (harness background workers — pure infra, no LLM
    // callers) which stays excluded, alongside starters named
    // `starter-<framework>[-lang]` (e.g. `starter-strands-python`,
    // `starter-langgraph-js`). Starters ARE checked now — a wired starter must
    // land in `wired`, not be silently skipped.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "harness-workers" }, // infra → excluded
          { name: "starter-adk" },
          { name: "starter-langgraph-js" },
          { name: "starter-ms-agent-framework-dotnet" },
          { name: "starter-ms-agent-framework-python" },
          { name: "starter-strands-python" },
          { name: "showcase-ag2" }, // real backend
        ],
        getServiceEnv: async (name) =>
          name === "harness-workers" ? {} : { OPENAI_BASE_URL: AIMOCK_URL },
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.unwired).toEqual([]);
    expect(r.signal.wired).toEqual([
      "showcase-ag2",
      "starter-adk",
      "starter-langgraph-js",
      "starter-ms-agent-framework-dotnet",
      "starter-ms-agent-framework-python",
      "starter-strands-python",
    ]);
    expect(r.signal.wiredCount).toBe(6);
  });

  it("checks starters alongside showcase-* backends (both in the checked universe)", async () => {
    // The old behavior excluded starters by prefix; now starters route through
    // aimock exactly like showcase-* backends and are checked identically.
    // Neither is wired here, so BOTH must surface as unwired.
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () => [
          { name: "starter-mastra" },
          { name: "showcase-mastra" }, // must still be checked
        ],
        getServiceEnv: async () => ({}), // neither wired
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual(["showcase-mastra", "starter-mastra"]);
  });

  it("full live roster: the 20 showcase-* backends AND 12 starters are checked, 9 infra excluded", async () => {
    // Locks the "checked universe == 20 showcase-* backends + 12 starters"
    // contract against the full 41-service production roster (9 infra + 20
    // backends + 12 starters). Backends and starters are all unwired here, so
    // `unwired` must equal exactly those 32 — only the 9 infra are excluded.
    const infra = [
      "aimock",
      "dashboard",
      "docs",
      "dojo",
      "harness",
      "harness-workers",
      "pocketbase",
      "shell",
      "webhooks",
    ];
    const backends = [
      "showcase-ag2",
      "showcase-agno",
      "showcase-built-in-agent",
      "showcase-claude-sdk-python",
      "showcase-claude-sdk-typescript",
      "showcase-crewai-crews",
      "showcase-google-adk",
      "showcase-langgraph-fastapi",
      "showcase-langgraph-python",
      "showcase-langgraph-typescript",
      "showcase-langroid",
      "showcase-llamaindex",
      "showcase-mastra",
      "showcase-ms-agent-dotnet",
      "showcase-ms-agent-harness-dotnet",
      "showcase-ms-agent-python",
      "showcase-pydantic-ai",
      "showcase-spring-ai",
      "showcase-strands",
      "showcase-strands-typescript",
    ];
    const starters = [
      "starter-adk",
      "starter-agno",
      "starter-crewai-crews",
      "starter-langgraph-fastapi",
      "starter-langgraph-js",
      "starter-langgraph-python",
      "starter-llamaindex",
      "starter-mastra",
      "starter-ms-agent-framework-dotnet",
      "starter-ms-agent-framework-python",
      "starter-pydantic-ai",
      "starter-strands-python",
    ];
    const r = await aimockWiringProbe.run(
      {
        aimockUrl: AIMOCK_URL,
        listServices: async () =>
          [...infra, ...backends, ...starters].map((name) => ({ name })),
        getServiceEnv: async () => ({}),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual([...backends, ...starters].sort());
    expect(r.signal.unwiredCount).toBe(32);
  });
});
