import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProgress,
  publishProgress,
  readProgress,
  subscribeProgress,
} from "./progress";

const CH = "test-channel";

describe("progress store", () => {
  beforeEach(() => clearProgress(CH));

  it("buffers events so a late subscriber still gets the backlog", () => {
    publishProgress(CH, { kind: "thinking", text: "reading csv", at: 1 });
    publishProgress(CH, { kind: "tool", label: "web_search", at: 2 });
    expect(readProgress(CH)).toHaveLength(2);
    expect(readProgress(CH)[1]).toMatchObject({ label: "web_search" });
  });

  it("pushes live events to a subscriber", () => {
    const seen: string[] = [];
    subscribeProgress(CH, (e) => seen.push(e.kind));
    publishProgress(CH, { kind: "thinking", text: "hm", at: 1 });
    publishProgress(CH, { kind: "done", at: 2 });
    expect(seen).toEqual(["thinking", "done"]);
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    subscribeProgress(CH, listener)();
    publishProgress(CH, { kind: "done", at: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("isolates channels from each other", () => {
    publishProgress(CH, { kind: "done", at: 1 });
    expect(readProgress("other")).toEqual([]);
  });

  it("drops the buffer on clear", () => {
    publishProgress(CH, { kind: "done", at: 1 });
    clearProgress(CH);
    expect(readProgress(CH)).toEqual([]);
  });

  // Regression: the tool calls clearProgress at run START, so a console that
  // subscribed while the previous run was on screen must survive it. Deleting
  // the channel instead of emptying its buffer left that console permanently
  // deaf — no frames, no `done`, stream open forever.
  it("keeps a subscriber registered before clear", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeProgress(CH, (e) => seen.push(e.kind));
    clearProgress(CH);
    publishProgress(CH, { kind: "thinking", text: "run two", at: 1 });
    publishProgress(CH, { kind: "done", at: 2 });
    unsubscribe();
    expect(seen).toEqual(["thinking", "done"]);
  });

  // Regression: a console that disconnected mid-run leaves a listener whose
  // `controller.enqueue` throws. Unguarded, that throw reached the harness's
  // own error handler and failed a multi-minute run.
  it("survives a throwing listener and keeps delivering to the others", () => {
    const seen: string[] = [];
    const unsubscribeBad = subscribeProgress(CH, () => {
      throw new Error("Invalid state: Controller is already closed");
    });
    const unsubscribeGood = subscribeProgress(CH, (e) => seen.push(e.kind));

    expect(() =>
      publishProgress(CH, { kind: "thinking", text: "hm", at: 1 }),
    ).not.toThrow();
    expect(seen).toEqual(["thinking"]);

    // The bad listener was dropped, so it cannot throw again.
    expect(() => publishProgress(CH, { kind: "done", at: 2 })).not.toThrow();
    expect(seen).toEqual(["thinking", "done"]);

    unsubscribeBad();
    unsubscribeGood();
  });
});
