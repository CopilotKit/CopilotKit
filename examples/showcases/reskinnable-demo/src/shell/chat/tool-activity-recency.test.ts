import { describe, expect, it, vi } from "vitest";
import { createToolActivityRecencyStore } from "./tool-activity-recency";

describe("tool activity recency", () => {
  it("does not make an old tool recent again when it remounts", () => {
    const store = createToolActivityRecencyStore(2);

    store.register("a");
    store.register("b");
    store.register("c");

    expect(store.isRecent("a")).toBe(false);
    expect(store.isRecent("b")).toBe(true);
    expect(store.isRecent("c")).toBe(true);

    // Virtualization can unmount and remount A. Re-registering the same
    // durable tool-call id must not mutate the original emission order.
    store.register("a");

    expect(store.isRecent("a")).toBe(false);
    expect(store.isRecent("b")).toBe(true);
    expect(store.isRecent("c")).toBe(true);
  });

  it("notifies only when a genuinely new tool enters the thread order", () => {
    const store = createToolActivityRecencyStore(2);
    const listener = vi.fn();
    store.subscribe(listener);

    store.register("a");
    store.register("a");
    store.register("b");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps different thread stores independent", () => {
    const first = createToolActivityRecencyStore(2);
    const second = createToolActivityRecencyStore(2);

    first.register("a");
    first.register("b");
    first.register("c");

    second.register("a");

    expect(first.isRecent("a")).toBe(false);
    expect(second.isRecent("a")).toBe(true);
  });
});
