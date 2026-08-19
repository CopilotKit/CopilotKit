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
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it("is enabled when NODE_ENV is not production", () => {
    expect(isInspectorThreadBridgeEnabled()).toBe(
      process.env.NODE_ENV !== "production",
    );
  });

  it("delivers view-thread from emit to on in the same realm", () => {
    const received: Array<{ threadId: string; agentId: string }> = [];
    cleanups.push(
      onInspectorViewThread((payload) => {
        received.push(payload);
      }),
    );

    emitInspectorViewThread({ threadId: "thread-1", agentId: "default" });

    expect(received).toEqual([{ threadId: "thread-1", agentId: "default" }]);
  });

  it("delivers stop-viewing, active-thread, and view-thread-result", () => {
    const stops: Array<{ agentId: string }> = [];
    const actives: Array<{
      threadId: string;
      agentId: string;
      source: "app" | "override";
    }> = [];
    const results: Array<{ ok: boolean }> = [];

    cleanups.push(onInspectorStopViewing((payload) => stops.push(payload)));
    cleanups.push(onInspectorActiveThread((payload) => actives.push(payload)));
    cleanups.push(
      onInspectorViewThreadResult((payload) => results.push(payload)),
    );

    emitInspectorStopViewing({ agentId: "default" });
    emitInspectorActiveThread({
      threadId: "thread-2",
      agentId: "default",
      source: "override",
    });
    emitInspectorViewThreadResult({
      threadId: "thread-2",
      agentId: "default",
      ok: true,
    });

    expect(stops).toEqual([{ agentId: "default" }]);
    expect(actives).toEqual([
      { threadId: "thread-2", agentId: "default", source: "override" },
    ]);
    expect(results).toEqual([
      { ok: true, threadId: "thread-2", agentId: "default" },
    ]);
  });

  it("does not notify a listener after unsubscribe", () => {
    const received: string[] = [];
    const unsubscribe = onInspectorViewThread((payload) => {
      received.push(payload.threadId);
    });
    unsubscribe();

    emitInspectorViewThread({ threadId: "late", agentId: "default" });

    expect(received).toEqual([]);
  });

  it("hides the bus when NODE_ENV is production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();

    return import("../inspector-thread-bridge")
      .then((mod) => {
        expect(mod.isInspectorThreadBridgeEnabled()).toBe(false);
        const received: string[] = [];
        const unsubscribe = mod.onInspectorViewThread((payload) => {
          received.push(payload.threadId);
        });
        mod.emitInspectorViewThread({ threadId: "prod", agentId: "default" });
        expect(received).toEqual([]);
        unsubscribe();
      })
      .finally(() => {
        process.env.NODE_ENV = original;
        vi.resetModules();
      });
  });
});
