import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitInspectorActiveThread,
  emitInspectorStopViewing,
  emitInspectorViewThread,
  emitInspectorViewThreadResult,
  isInspectorThreadBridgeEnabled,
  onInspectorActiveThread,
  onInspectorStopViewing,
  onInspectorViewThread,
  onInspectorViewThreadResult,
} from "../inspector-thread-bridge";

describe("inspector thread bridge", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("is enabled when NODE_ENV is not production", () => {
    expect(isInspectorThreadBridgeEnabled()).toBe(
      process.env.NODE_ENV !== "production",
    );
  });

  it("lets a matching chat claim view-thread", () => {
    const received: string[] = [];
    cleanups.push(
      onInspectorViewThread((payload) => {
        received.push(payload.threadId);
        return payload.agentId === "default";
      }),
    );

    const handled = emitInspectorViewThread({
      requestId: "request-1",
      threadId: "thread-1",
      agentId: "default",
    });

    expect(handled).toBe(true);
    expect(received).toEqual(["thread-1"]);
  });

  it("stops after the first chat claims a request", () => {
    const claimants: string[] = [];
    cleanups.push(
      onInspectorViewThread(() => {
        claimants.push("first");
        return true;
      }),
      onInspectorViewThread(() => {
        claimants.push("second");
        return true;
      }),
    );

    expect(
      emitInspectorViewThread({
        requestId: "request-2",
        threadId: "thread-2",
        agentId: "default",
      }),
    ).toBe(true);
    expect(claimants).toEqual(["first"]);
  });

  it("returns false when no chat claims a request", () => {
    cleanups.push(onInspectorViewThread(() => false));
    expect(
      emitInspectorViewThread({
        requestId: "request-3",
        threadId: "thread-3",
        agentId: "other",
      }),
    ).toBe(false);
  });

  it("delivers request-correlated lifecycle events", () => {
    const stops: string[] = [];
    const actives: string[] = [];
    const results: boolean[] = [];
    cleanups.push(
      onInspectorStopViewing((payload) => stops.push(payload.requestId)),
      onInspectorActiveThread((payload) => actives.push(payload.requestId)),
      onInspectorViewThreadResult((payload) => results.push(payload.ok)),
    );

    emitInspectorStopViewing({ requestId: "request-4", agentId: "default" });
    emitInspectorActiveThread({
      requestId: "request-4",
      threadId: "thread-4",
      agentId: "default",
      source: "override",
    });
    emitInspectorViewThreadResult({
      requestId: "request-4",
      threadId: "thread-4",
      agentId: "default",
      ok: true,
    });

    expect(stops).toEqual(["request-4"]);
    expect(actives).toEqual(["request-4"]);
    expect(results).toEqual([true]);
  });

  it("does not notify a listener after unsubscribe", () => {
    const received: string[] = [];
    const unsubscribe = onInspectorViewThread((payload) => {
      received.push(payload.threadId);
      return true;
    });
    unsubscribe();

    expect(
      emitInspectorViewThread({
        requestId: "request-5",
        threadId: "late",
        agentId: "default",
      }),
    ).toBe(false);
    expect(received).toEqual([]);
  });

  it("hides the bus when NODE_ENV is production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();

    try {
      const mod = await import("../inspector-thread-bridge");
      expect(mod.isInspectorThreadBridgeEnabled()).toBe(false);
      const received: string[] = [];
      const unsubscribe = mod.onInspectorViewThread((payload) => {
        received.push(payload.threadId);
        return true;
      });
      expect(
        mod.emitInspectorViewThread({
          requestId: "request-prod",
          threadId: "prod",
          agentId: "default",
        }),
      ).toBe(false);
      expect(received).toEqual([]);
      unsubscribe();
    } finally {
      process.env.NODE_ENV = original;
      vi.resetModules();
    }
  });
});
