// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BrowserTargetHighlighter } from "../autopilot/browser-target-highlighter";

describe("BrowserTargetHighlighter", () => {
  it("marks the proposed target without focus or activation and restores its style", () => {
    const button = document.createElement("button");
    button.style.outline = "1px dotted black";
    let clicks = 0;
    button.addEventListener("click", () => clicks++);
    document.body.appendChild(button);
    const highlighter = new BrowserTargetHighlighter();
    const clear = highlighter.highlight(button);
    expect(button.hasAttribute("data-copilot-highlight")).toBe(true);
    expect(document.activeElement).not.toBe(button);
    expect(clicks).toBe(0);
    clear();
    expect(button.hasAttribute("data-copilot-highlight")).toBe(false);
    expect(button.style.outline).toBe("1px dotted black");
    button.remove();
  });
});
