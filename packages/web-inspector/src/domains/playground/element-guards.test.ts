import { afterEach, describe, expect, it } from "vitest";
import { createSameOriginFrame } from "../../testing/same-origin-frame.js";
import { isPlaygroundSelectElement } from "./element-guards.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Playground element guards", () => {
  it("accepts a thread selector owned by another same-origin window", () => {
    const frame = createSameOriginFrame();
    try {
      const select = frame.document.createElement("select");
      select.append(new Option("Saved thread", "thread-1"));
      frame.document.body.append(select);
      select.value = "thread-1";
      expect(select).not.toBeInstanceOf(HTMLSelectElement);

      let selectedThreadId: string | null = null;
      select.addEventListener("change", (event) => {
        if (isPlaygroundSelectElement(event.currentTarget)) {
          selectedThreadId = event.currentTarget.value;
        }
      });
      select.dispatchEvent(new frame.window.Event("change", { bubbles: true }));

      expect(selectedThreadId).toBe("thread-1");
    } finally {
      frame.remove();
    }
  });
});
