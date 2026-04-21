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
          { name: "showcase-ops" },
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
    expect(r.signal.probeErrorDesc).toBe(
      "aimockUrl parse failed: not a url",
    );
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
});
