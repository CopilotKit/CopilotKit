import { describe, expect, it } from "vitest";
import { waitForActiveRunToSettle } from "../intelligence-agent";

describe("waitForActiveRunToSettle", () => {
  it("returns immediately when the agent is not running", async () => {
    await expect(
      waitForActiveRunToSettle({ isRunning: false }),
    ).resolves.toBeUndefined();
  });

  it("waits until a late completion handle is assigned, then awaits it", async () => {
    let resolveRun: () => void = () => {};
    const agent: {
      isRunning: boolean;
      activeRunCompletionPromise?: Promise<void>;
    } = { isRunning: true };

    let settled = false;
    const waiter = waitForActiveRunToSettle(agent).then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    agent.activeRunCompletionPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    resolveRun();
    await waiter;
    expect(settled).toBe(true);
  });

  it("returns when isRunning clears without a completion handle", async () => {
    const agent = { isRunning: true };
    const waiter = waitForActiveRunToSettle(agent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    agent.isRunning = false;
    await waiter;
  });
});
