import type { ProductInteractionEvent } from "@copilotkit/learning";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackProductChangeThreads } from "../product-change-thread";

const change: Extract<ProductInteractionEvent, { type: "interaction" }> = {
  type: "interaction",
  action: "change",
  id: "change",
  actionId: "change",
  timestamp: 1,
  target: { tagName: "input" },
};
const click: Extract<ProductInteractionEvent, { type: "interaction" }> = {
  ...change,
  action: "click",
};

function setup(initialThread: string | undefined) {
  let thread = initialThread;
  const listenerSpy = vi.spyOn(window, "addEventListener");
  const tracker = trackProductChangeThreads(window, () => thread);

  // Exercise the listener contract directly. Actual trusted keyboard and blur
  // behavior is verified separately by the recorded Chromium regression.
  const deliver = (
    type: "input" | "change" | "focusout",
    target: EventTarget,
    trusted = true,
  ) => {
    const listener = listenerSpy.mock.calls.find(
      ([name]) => name === type,
    )?.[1];
    if (!listener) return;
    const event = new Proxy(new Event(type), {
      get(source, property) {
        if (property === "isTrusted") return trusted;
        if (property === "target") return target;
        return Reflect.get(source, property, source);
      },
    });
    if (typeof listener === "function") listener.call(window, event);
    else listener.handleEvent(event);
  };

  return {
    tracker,
    deliver,
    select: (next: string | undefined) => {
      thread = next;
    },
  };
}

describe("committed product-change attribution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps an edit on A after pointer selection changes to B, then permits a new B edit", () => {
    const { tracker, deliver, select } = setup("A");
    const field = document.createElement("input");
    try {
      deliver("input", field);
      select("B");
      deliver("input", field);
      deliver("change", field);
      expect(tracker.getThreadId(change)).toBe("A");
      expect(tracker.getThreadId(click)).toBe("B");

      deliver("input", field);
      deliver("change", field);
      expect(tracker.getThreadId(change)).toBe("B");
    } finally {
      tracker.stop();
    }
  });

  it("keeps contenteditable commits on their editing thread after blur selects another chat", () => {
    const { tracker, deliver, select } = setup("A");
    const field = document.createElement("div");
    field.setAttribute("contenteditable", "true");
    try {
      deliver("input", field);
      select("B");
      deliver("focusout", field);
      expect(tracker.getThreadId(change)).toBe("A");
      expect(tracker.getThreadId(click)).toBe("B");
    } finally {
      tracker.stop();
    }
  });

  it("omits an edit begun without a thread even if a chat is selected before commit", () => {
    const { tracker, deliver, select } = setup(undefined);
    const field = document.createElement("input");
    try {
      deliver("input", field);
      select("B");
      deliver("change", field);
      expect(tracker.getThreadId(change)).toBeUndefined();
      expect(tracker.getThreadId(click)).toBe("B");
    } finally {
      tracker.stop();
    }
  });

  it("ends an edit on blur even when reverting the value emits no change", () => {
    const { tracker, deliver, select } = setup("A");
    const field = document.createElement("input");
    try {
      deliver("input", field);
      deliver("input", field);
      select("B");
      deliver("focusout", field);

      deliver("input", field);
      deliver("change", field);
      expect(tracker.getThreadId(change)).toBe("B");
    } finally {
      tracker.stop();
    }
  });

  it("ignores synthetic input and keeps independent field origins separate", () => {
    const { tracker, deliver, select } = setup("A");
    const first = document.createElement("input");
    const second = document.createElement("input");
    try {
      deliver("input", first, false);
      select("B");
      deliver("input", second);
      select("C");
      deliver("change", first);
      expect(tracker.getThreadId(change)).toBe("C");
      deliver("change", second, false);
      deliver("change", second);
      expect(tracker.getThreadId(change)).toBe("B");
    } finally {
      tracker.stop();
    }
  });
});
