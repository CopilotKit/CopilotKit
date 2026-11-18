import { afterEach, describe, expect, it } from "vitest";
import type {
  InspectorActiveThreadPayload,
  InspectorViewThreadResultPayload,
} from "../inspector-thread-bridge";
import {
  emitInspectorStopViewing,
  emitInspectorViewThread,
  onInspectorActiveThread,
  onInspectorViewThreadResult,
  ɵInspectorThreadOverride,
} from "../inspector-thread-bridge";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A subscribed override plus the bridge events it emitted. */
function createOverride(agentId = "default", baseThreadId = "base") {
  const controller = new ɵInspectorThreadOverride({ agentId, baseThreadId });
  const actives: InspectorActiveThreadPayload[] = [];
  const results: InspectorViewThreadResultPayload[] = [];
  cleanups.push(
    controller.subscribe(() => {}),
    () => controller.dispose(),
    onInspectorActiveThread((payload) => actives.push(payload)),
    onInspectorViewThreadResult((payload) => results.push(payload)),
  );
  return { controller, actives, results };
}

function viewThread(threadId: string, requestId = "r1", agentId = "default") {
  return emitInspectorViewThread({ requestId, threadId, agentId });
}

describe("ɵInspectorThreadOverride", () => {
  it("claims a matching view request and exposes the thread", () => {
    const { controller, actives, results } = createOverride();

    const claimed = viewThread("inspected");

    expect(claimed).toBe(true);
    expect(controller.getSnapshot()).toEqual({
      threadId: "inspected",
      requestId: "r1",
    });
    expect(results).toEqual([
      { requestId: "r1", threadId: "inspected", agentId: "default", ok: true },
    ]);
    expect(actives).toEqual([
      {
        requestId: "r1",
        threadId: "inspected",
        agentId: "default",
        source: "override",
      },
    ]);
  });

  it("does not claim a request for another agent", () => {
    const { controller } = createOverride("support");

    expect(viewThread("inspected")).toBe(false);
    expect(controller.getSnapshot()).toBeNull();
  });

  it("does not listen before the first subscriber", () => {
    const controller = new ɵInspectorThreadOverride({
      agentId: "default",
      baseThreadId: "base",
    });
    cleanups.push(() => controller.dispose());

    expect(viewThread("inspected")).toBe(false);
  });

  it("restores the previous thread when the Inspector stops viewing", () => {
    const { controller, actives } = createOverride();
    viewThread("inspected");

    emitInspectorStopViewing({ requestId: "r1", agentId: "default" });

    expect(controller.getSnapshot()).toBeNull();
    expect(actives.at(-1)).toEqual({
      requestId: "r1",
      threadId: "base",
      agentId: "default",
      source: "app",
    });
  });

  it("ignores a stop for another request", () => {
    const { controller } = createOverride();
    viewThread("inspected");

    emitInspectorStopViewing({ requestId: "other", agentId: "default" });

    expect(controller.getSnapshot()).toEqual({
      threadId: "inspected",
      requestId: "r1",
    });
  });

  it("keeps the first previous thread across repeated view requests", () => {
    const { controller, actives } = createOverride();
    viewThread("first", "r1");
    viewThread("second", "r2");

    emitInspectorStopViewing({ requestId: "r2", agentId: "default" });

    expect(controller.getSnapshot()).toBeNull();
    expect(actives.at(-1)?.threadId).toBe("base");
  });

  it("restores the previous thread when the chat's agent changes", () => {
    const { controller, actives } = createOverride();
    viewThread("inspected");

    controller.update({ agentId: "support", baseThreadId: "base" });

    expect(controller.getSnapshot()).toBeNull();
    expect(actives.at(-1)).toMatchObject({ threadId: "base", source: "app" });
  });

  it("hands over to the chat's own thread when it changes", () => {
    const { controller, actives } = createOverride();
    viewThread("inspected");

    controller.update({ agentId: "default", baseThreadId: "picked" });

    expect(controller.getSnapshot()).toBeNull();
    expect(actives.at(-1)).toMatchObject({ threadId: "picked", source: "app" });
  });

  it("keeps the override when the chat's thread follows it", () => {
    const { controller } = createOverride();
    viewThread("inspected");

    controller.update({ agentId: "default", baseThreadId: "inspected" });

    expect(controller.getSnapshot()?.threadId).toBe("inspected");
  });

  it("reports a failed connect and restores the previous thread", () => {
    const { controller, results, actives } = createOverride();
    viewThread("inspected");

    controller.fail("r1");

    expect(controller.getSnapshot()).toBeNull();
    expect(results.at(-1)).toEqual({
      requestId: "r1",
      threadId: "inspected",
      agentId: "default",
      ok: false,
      reason: "connect-failed",
    });
    expect(actives.at(-1)).toMatchObject({ threadId: "base", source: "app" });
  });

  it("ignores a failure for a request that is no longer current", () => {
    const { controller, results } = createOverride();
    viewThread("inspected");

    controller.fail("stale");

    expect(controller.getSnapshot()?.requestId).toBe("r1");
    expect(results).toHaveLength(1);
  });

  it("stops listening when the last subscriber leaves", () => {
    const controller = new ɵInspectorThreadOverride({
      agentId: "default",
      baseThreadId: "base",
    });
    const unsubscribe = controller.subscribe(() => {});
    unsubscribe();

    expect(viewThread("inspected")).toBe(false);
  });
});
