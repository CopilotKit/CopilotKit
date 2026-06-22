import { describe, expect, it, vi } from "vitest";
import type { LearnFromUserActionInput } from "../../hooks/use-learn-from-user-action";
import {
  DEFAULT_METHODS,
  isRecorderEndpoint,
  processExchange,
  resolveConfig,
  shouldCapture,
} from "../pipeline";
import type { PipelineContext } from "../pipeline";
import type { AutoCaptureUserActionsConfig, RawExchange } from "../types";

const ORIGIN = "https://app.test";
const RUNTIME_URL = "https://app.test/api/copilotkit";

const rawExchange = (over: Partial<RawExchange> = {}): RawExchange => ({
  method: "POST",
  url: `${ORIGIN}/api/orders/1/refund`,
  requestBody: { reason: "damaged" },
  status: 200,
  responseBody: { ok: true },
  durationMs: 5,
  ...over,
});

const setup = (
  config: AutoCaptureUserActionsConfig = {},
  over: Partial<PipelineContext> = {},
) => {
  const records: LearnFromUserActionInput[] = [];
  const onMissingThread = vi.fn();
  const ctx: PipelineContext = {
    config: resolveConfig(config),
    origin: ORIGIN,
    runtimeUrl: RUNTIME_URL,
    resolveThreadId: () => "thread-1",
    record: (input) => records.push(input),
    onMissingThread,
    ...over,
  };
  return { ctx, records, onMissingThread };
};

describe("resolveConfig", () => {
  it("defaults to the mutating methods and response-body capture", () => {
    const resolved = resolveConfig({});

    expect([...resolved.methods].sort()).toEqual([...DEFAULT_METHODS].sort());
    expect(resolved.captureResponseBody).toBe(true);
    expect(resolved.denyUrls).toEqual([]);
    expect(resolved.allowUrls).toBeUndefined();
  });

  it("uppercases custom methods", () => {
    const resolved = resolveConfig({ methods: ["get"] as never });
    expect(resolved.methods.has("GET")).toBe(true);
  });
});

describe("isRecorderEndpoint", () => {
  it("matches the platform endpoint regardless of query string", () => {
    expect(isRecorderEndpoint(`${RUNTIME_URL}/annotate?x=1`, RUNTIME_URL)).toBe(
      true,
    );
  });

  it("does not match other endpoints", () => {
    expect(isRecorderEndpoint(`${RUNTIME_URL}/agent`, RUNTIME_URL)).toBe(false);
  });

  it("is false when runtimeUrl is unknown", () => {
    expect(isRecorderEndpoint(`${ORIGIN}/x`, undefined)).toBe(false);
  });
});

describe("shouldCapture", () => {
  const base = { origin: ORIGIN, runtimeUrl: RUNTIME_URL };

  it("captures in-scope mutating same-origin requests", () => {
    expect(
      shouldCapture("POST", `${ORIGIN}/api/x`, {
        ...base,
        config: resolveConfig({}),
      }),
    ).toBe(true);
  });

  it("ignores non-configured methods", () => {
    expect(
      shouldCapture("GET", `${ORIGIN}/api/x`, {
        ...base,
        config: resolveConfig({}),
      }),
    ).toBe(false);
  });

  it("never captures the platform's own annotate endpoint", () => {
    expect(
      shouldCapture("POST", `${RUNTIME_URL}/annotate`, {
        ...base,
        config: resolveConfig({}),
      }),
    ).toBe(false);
  });

  it("excludes denyUrls matches", () => {
    expect(
      shouldCapture("POST", `${ORIGIN}/private/x`, {
        ...base,
        config: resolveConfig({ denyUrls: ["/private"] }),
      }),
    ).toBe(false);
  });

  it("ignores cross-origin requests by default", () => {
    expect(
      shouldCapture("POST", "https://other.test/x", {
        ...base,
        config: resolveConfig({}),
      }),
    ).toBe(false);
  });

  it("captures cross-origin requests when allowUrls matches", () => {
    expect(
      shouldCapture("POST", "https://other.test/x", {
        ...base,
        config: resolveConfig({ allowUrls: ["https://other.test"] }),
      }),
    ).toBe(true);
  });
});

describe("processExchange", () => {
  it("records a mapped action with the resolved threadId", () => {
    const { ctx, records } = setup();

    processExchange(rawExchange(), ctx);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      threadId: "thread-1",
      title: "POST /api/orders/1/refund",
      data: {
        url: `${ORIGIN}/api/orders/1/refund`,
        status: 200,
        durationMs: 5,
        requestBody: { reason: "damaged" },
        responseBody: { ok: true },
      },
    });
  });

  it("redacts sensitive fields before recording", () => {
    const { ctx, records } = setup();

    processExchange(
      rawExchange({ requestBody: { password: "hunter2", name: "alice" } }),
      ctx,
    );

    expect((records[0]!.data as { requestBody: unknown }).requestBody).toEqual({
      password: "***",
      name: "alice",
    });
  });

  it("skips requests that should not be captured", () => {
    const { ctx, records } = setup();

    processExchange(rawExchange({ method: "GET" }), ctx);

    expect(records).toHaveLength(0);
  });

  it("warns and skips when no thread is resolvable", () => {
    const { ctx, records, onMissingThread } = setup(
      {},
      {
        resolveThreadId: () => null,
      },
    );

    processExchange(rawExchange(), ctx);

    expect(records).toHaveLength(0);
    expect(onMissingThread).toHaveBeenCalledTimes(1);
  });

  it("uses a custom transform and skips when it returns null", () => {
    const transform = vi.fn(() => null);
    const { ctx, records } = setup({ transform });

    processExchange(rawExchange(), ctx);

    expect(transform).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(0);
  });

  it("hands transform an already-redacted envelope", () => {
    let seen: unknown;
    const { ctx } = setup({
      transform: (req) => {
        seen = req.requestBody;
        return { title: "custom" };
      },
    });

    processExchange(rawExchange({ requestBody: { token: "abc" } }), ctx);

    expect(seen).toEqual({ token: "***" });
  });

  it("never throws when the recorder throws", () => {
    const { ctx } = setup(
      {},
      {
        record: () => {
          throw new Error("recorder boom");
        },
      },
    );

    expect(() => processExchange(rawExchange(), ctx)).not.toThrow();
  });

  it("never throws when transform itself throws (capture is best-effort)", () => {
    const { ctx, records } = setup({
      transform: () => {
        throw new Error("transform boom");
      },
    });

    expect(() => processExchange(rawExchange(), ctx)).not.toThrow();
    expect(records).toHaveLength(0);
  });

  it("clears responseBody in the captured envelope when captureResponseBody is false", () => {
    let seen: { responseBody?: unknown } = {};
    const { ctx } = setup({
      captureResponseBody: false,
      transform: (req) => {
        seen = req;
        return { title: "x" };
      },
    });

    processExchange(rawExchange({ responseBody: { confidential: true } }), ctx);

    // The property exists on CapturedRequest but its value is undefined,
    // so a transform reading req.responseBody will never see the real body.
    expect(seen.responseBody).toBeUndefined();
  });
});

describe("shouldCapture precedence and casing", () => {
  const base = { origin: ORIGIN, runtimeUrl: RUNTIME_URL };

  it("denyUrls beats allowUrls when both match the same URL", () => {
    expect(
      shouldCapture("POST", `${ORIGIN}/api/x`, {
        ...base,
        config: resolveConfig({
          allowUrls: [/api/],
          denyUrls: [/\/x$/],
        }),
      }),
    ).toBe(false);
  });

  it("treats method case-insensitively (lowercase post still matches POST)", () => {
    expect(
      shouldCapture("post", `${ORIGIN}/api/x`, {
        ...base,
        config: resolveConfig({}),
      }),
    ).toBe(true);
  });

  it("matches a mixed string + RegExp allowUrls list", () => {
    expect(
      shouldCapture("POST", "https://api.partner.test/v1/x", {
        ...base,
        config: resolveConfig({
          allowUrls: ["api.partner.test", /\/v2\//],
        }),
      }),
    ).toBe(true);
  });

  it("handles a runtimeUrl with a trailing slash for self-exclusion", () => {
    expect(
      isRecorderEndpoint(
        `${ORIGIN}/api/copilotkit/annotate`,
        `${ORIGIN}/api/copilotkit/`,
      ),
    ).toBe(true);
  });
});

describe("origin-level scoping (allowOrigins / denyOrigins)", () => {
  const base = { origin: ORIGIN, runtimeUrl: RUNTIME_URL };

  it("allowOrigins is additive — same-origin still captured when allowOrigins lists only a third party", () => {
    const config = resolveConfig({
      allowOrigins: ["https://api.partner.test"],
    });

    expect(shouldCapture("POST", `${ORIGIN}/api/x`, { ...base, config })).toBe(
      true,
    );
    expect(
      shouldCapture("POST", "https://api.partner.test/v1/x", {
        ...base,
        config,
      }),
    ).toBe(true);
    expect(
      shouldCapture("POST", "https://other.test/x", { ...base, config }),
    ).toBe(false);
  });

  it("allowOrigins layers on top of allowUrls (URL-level whitelist still replaces same-origin)", () => {
    const config = resolveConfig({
      allowUrls: ["/some-path"],
      allowOrigins: ["https://api.partner.test"],
    });

    // allowUrls matched
    expect(
      shouldCapture("POST", `${ORIGIN}/some-path/x`, { ...base, config }),
    ).toBe(true);
    // allowOrigins matched
    expect(
      shouldCapture("POST", "https://api.partner.test/anything", {
        ...base,
        config,
      }),
    ).toBe(true);
    // neither matched — allowUrls semantics applies (no same-origin default)
    expect(
      shouldCapture("POST", `${ORIGIN}/something-else`, { ...base, config }),
    ).toBe(false);
  });

  it("denyOrigins excludes even a same-origin request when its origin matches", () => {
    const config = resolveConfig({ denyOrigins: [ORIGIN] });

    expect(shouldCapture("POST", `${ORIGIN}/api/x`, { ...base, config })).toBe(
      false,
    );
  });

  it("denyOrigins beats allowOrigins (deny rules always win)", () => {
    const config = resolveConfig({
      allowOrigins: ["https://api.partner.test"],
      denyOrigins: ["https://api.partner.test"],
    });

    expect(
      shouldCapture("POST", "https://api.partner.test/x", { ...base, config }),
    ).toBe(false);
  });
});

describe("string pattern matching — bare-hostname footgun", () => {
  const base = { origin: ORIGIN, runtimeUrl: RUNTIME_URL };

  it("a bare-hostname pattern matches only the exact URL hostname", () => {
    const config = resolveConfig({ allowUrls: ["api.foo.com"] });

    expect(
      shouldCapture("POST", "https://api.foo.com/v1/x", { ...base, config }),
    ).toBe(true);
    // Subdomain — does not match a bare hostname.
    expect(
      shouldCapture("POST", "https://v2.api.foo.com/x", { ...base, config }),
    ).toBe(false);
    // The classic substring-attack URL — would have matched under plain
    // `url.includes("api.foo.com")` before this change.
    expect(
      shouldCapture("POST", "https://api.foo.com.attacker.test/payload", {
        ...base,
        config,
      }),
    ).toBe(false);
  });

  it("path-shaped string patterns keep substring matching for backward compat", () => {
    const config = resolveConfig({ denyUrls: ["/private"] });

    expect(
      shouldCapture("POST", `${ORIGIN}/api/private/foo`, {
        ...base,
        config,
      }),
    ).toBe(false);
    expect(
      shouldCapture("POST", `${ORIGIN}/api/public/foo`, {
        ...base,
        config,
      }),
    ).toBe(true);
  });

  it("the hostname-aware rule also applies to denyUrls", () => {
    const config = resolveConfig({ denyUrls: ["api.foo.com"] });

    expect(
      shouldCapture("POST", "https://api.foo.com/x", {
        ...base,
        config: { ...config, allowUrls: [/.*/] },
      }),
    ).toBe(false);
    // attacker URL: bare-hostname deny does NOT match it (and same-origin
    // default doesn't include it either) — so capture rests on allowUrls
    expect(
      shouldCapture("POST", "https://api.foo.com.attacker.test/x", {
        ...base,
        config: { ...config, allowUrls: [/.*/] },
      }),
    ).toBe(true);
  });
});
