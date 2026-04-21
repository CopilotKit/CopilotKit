import { describe, it, expect } from "vitest";
import { aimockWiringProbe } from "./aimock-wiring.js";
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
  });
});
