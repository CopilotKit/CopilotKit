import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserRequestBudget } from "../autopilot/browser-request-budget";

const identity = {
  userId: "admin",
  organizationId: "northstar",
  agentId: "logistics",
  threadId: "thread-1",
  requestId: "user-message-1",
};

afterEach(() => vi.unstubAllGlobals());

describe("BrowserRequestBudget", () => {
  it("shares eight action attempts across instances and follow-up runs", async () => {
    const values = new Map<string, string>();
    let queue = Promise.resolve();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: (_key: string, callback: () => Promise<unknown>) => {
          const result = queue.then(callback);
          queue = result.then(() => undefined);
          return result;
        },
      },
    });
    const first = new BrowserRequestBudget();
    const second = new BrowserRequestBudget();
    const decisions = await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        (index % 2 ? second : first).consume(identity, "action"),
      ),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(8);
    expect(decisions[8]).toMatchObject({ allowed: false, remaining: 0 });
    expect(await first.consume(identity, "read")).toMatchObject({
      allowed: true,
      remaining: 11,
    });
    expect(
      await second.consume(
        { ...identity, requestId: "user-message-2" },
        "action",
      ),
    ).toMatchObject({ allowed: true, remaining: 7 });
  });

  it("fails closed without request identity or browser coordination", async () => {
    vi.stubGlobal("window", { localStorage: {} });
    vi.stubGlobal("navigator", {});
    const budget = new BrowserRequestBudget();
    expect(
      await budget.consume({ ...identity, requestId: "" }, "action"),
    ).toMatchObject({
      allowed: false,
      reason: "Request identity is unavailable",
    });
    expect(await budget.consume(identity, "action")).toMatchObject({
      allowed: false,
      reason: "Request coordination is unavailable",
    });
  });
});
