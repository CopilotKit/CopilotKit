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
});
