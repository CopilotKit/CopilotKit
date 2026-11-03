import { describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { runA2UIAction, toA2UIClientEvent } from "../actions";
import type {
  A2UIActionCore,
  A2UIClientEvent,
  A2UIUserAction,
} from "../actions";

const userAction: A2UIUserAction = {
  name: "confirm",
  surfaceId: "form",
  sourceComponentId: "button",
  timestamp: "2026-01-01T00:00:00.000Z",
  context: { n: 1 },
};
const message: A2UIClientEvent = { userAction };

/** A core stand-in that records the properties each run started with. */
function createCore() {
  const runs: Record<string, unknown>[] = [];
  const core = {
    properties: { existing: true } as Record<string, unknown>,
    setProperties(properties: Record<string, unknown>) {
      core.properties = properties;
    },
    runAgent: vi.fn(async () => {
      runs.push({ ...core.properties });
      return { result: undefined, newMessages: [] };
    }),
  } satisfies A2UIActionCore;
  return { core, runs };
}

const agent = new HttpAgent({ url: "http://localhost" });

describe("toA2UIClientEvent", () => {
  it("wraps a full action unchanged", () => {
    expect(toA2UIClientEvent(userAction)).toEqual({ userAction });
  });

  it("fills the fields a partial action leaves out", () => {
    const event = toA2UIClientEvent({});
    expect(event.userAction).toMatchObject({
      name: "unknown",
      surfaceId: "default",
      sourceComponentId: "",
    });
    expect(typeof event.userAction.timestamp).toBe("string");
  });
});

describe("runA2UIAction", () => {
  it("runs the agent with the envelope as a2uiAction, then removes it", async () => {
    const { core, runs } = createCore();
    await runA2UIAction({ message, agent, core });
    expect(runs).toEqual([{ existing: true, a2uiAction: message }]);
    expect(core.properties).toEqual({ existing: true });
  });

  it("removes a2uiAction even when the run fails", async () => {
    const { core } = createCore();
    core.runAgent.mockRejectedValueOnce(new Error("boom"));
    await expect(runA2UIAction({ message, agent, core })).rejects.toThrow(
      "boom",
    );
    expect(core.properties).toEqual({ existing: true });
  });

  it("does nothing without an agent", async () => {
    const { core, runs } = createCore();
    await runA2UIAction({ message, agent: undefined, core });
    expect(runs).toEqual([]);
  });

  it("does not run the agent when the interceptor returns null", async () => {
    const { core, runs } = createCore();
    await runA2UIAction({ message, agent, core, onAction: () => null });
    expect(runs).toEqual([]);
  });

  it("forwards the action the interceptor returns", async () => {
    const { core, runs } = createCore();
    const modified = { ...userAction, name: "navigate_handled" };
    await runA2UIAction({ message, agent, core, onAction: () => modified });
    expect(runs).toEqual([
      { existing: true, a2uiAction: { userAction: modified } },
    ]);
  });

  it("forwards the original action when the interceptor returns nothing", async () => {
    const { core, runs } = createCore();
    await runA2UIAction({ message, agent, core, onAction: () => undefined });
    expect(runs).toEqual([{ existing: true, a2uiAction: message }]);
  });
});
