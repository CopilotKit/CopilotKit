import { describe, expect, it, vi } from "vitest";
import type { RecordUserActionInput } from "../../hooks/use-record-user-action";
import {
  DEFAULT_METHODS,
  isUserActionsEndpoint,
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
  const records: RecordUserActionInput[] = [];
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

describe("isUserActionsEndpoint", () => {
  it("matches the platform endpoint regardless of query string", () => {
    expect(
      isUserActionsEndpoint(`${RUNTIME_URL}/user-actions?x=1`, RUNTIME_URL),
    ).toBe(true);
  });

  it("does not match other endpoints", () => {
    expect(isUserActionsEndpoint(`${RUNTIME_URL}/agent`, RUNTIME_URL)).toBe(
      false,
    );
  });

  it("is false when runtimeUrl is unknown", () => {
    expect(isUserActionsEndpoint(`${ORIGIN}/x`, undefined)).toBe(false);
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

  it("never captures the platform's own user-actions endpoint", () => {
    expect(
      shouldCapture("POST", `${RUNTIME_URL}/user-actions`, {
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
      newData: { reason: "damaged" },
    });
  });

  it("redacts sensitive fields before recording", () => {
    const { ctx, records } = setup();

    processExchange(
      rawExchange({ requestBody: { password: "hunter2", name: "alice" } }),
      ctx,
    );

    expect(records[0]!.newData).toEqual({ password: "***", name: "alice" });
  });

  it("skips requests that should not be captured", () => {
    const { ctx, records } = setup();

    processExchange(rawExchange({ method: "GET" }), ctx);

    expect(records).toHaveLength(0);
  });

  it("warns and skips when no thread is resolvable", () => {
    const { ctx, records, onMissingThread } = setup({}, {
      resolveThreadId: () => null,
    });

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

    processExchange(
      rawExchange({ requestBody: { token: "abc" } }),
      ctx,
    );

    expect(seen).toEqual({ token: "***" });
  });

  it("never throws when the recorder throws", () => {
    const { ctx } = setup({}, {
      record: () => {
        throw new Error("recorder boom");
      },
    });

    expect(() => processExchange(rawExchange(), ctx)).not.toThrow();
  });
});
