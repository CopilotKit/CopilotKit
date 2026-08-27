import { afterEach, describe, expect, it, vi } from "vitest";
import { createSameOriginFrame } from "../../testing/same-origin-frame.js";
import { submitPlaygroundOnEnter, updatePlaygroundInput } from "./composer.js";
import { createPlaygroundState } from "./state.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Playground composer cross-realm events", () => {
  it("updates and submits from a textarea owned by another same-origin window", () => {
    const frame = createSameOriginFrame();
    try {
      const state = createPlaygroundState();
      const requestUpdate = vi.fn();
      const form = frame.document.createElement("form");
      const textarea = frame.document.createElement("textarea");
      form.append(textarea);
      frame.document.body.append(form);
      expect(textarea).not.toBeInstanceOf(HTMLTextAreaElement);

      textarea.addEventListener("input", (event) =>
        updatePlaygroundInput(state, event, requestUpdate),
      );
      textarea.value = "Message from the pop-out";
      textarea.dispatchEvent(
        new frame.window.Event("input", { bubbles: true }),
      );

      let submitted = false;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitted = true;
      });
      textarea.addEventListener("keydown", submitPlaygroundOnEnter);
      const enter = new frame.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      textarea.dispatchEvent(enter);

      expect(state.input).toBe("Message from the pop-out");
      expect(requestUpdate).toHaveBeenCalledOnce();
      expect(enter.defaultPrevented).toBe(true);
      expect(submitted).toBe(true);
    } finally {
      frame.remove();
    }
  });
});
