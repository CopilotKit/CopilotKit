import React from "react";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChatView } from "../../components/chat/CopilotChatView";

const CHAT_ROOT_SELECTOR = ".copilotKitChat[data-copilotkit]";

const globalsCss = readFileSync("src/styles/globals.css", {
  encoding: "utf8",
});

/** Returns the body of the first `@layer <name> { ... }` block. */
function layerBody(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name} {`);
  if (start === -1) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      return css.slice(css.indexOf("{", start) + 1, i);
    }
  }
  return "";
}

// PE-788: the chat root is an inline-size container (`cpk:@container`), so its
// content gives it no intrinsic width. As a flex item in a row (the documented
// <CopilotThreadsDrawer> + <CopilotChat> layout) its auto width resolved to
// 0px. jsdom does no layout, so these tests pin the two halves of the fix: the
// base-layer width rule, and a chat root that the rule's selector matches.
describe("CopilotChat root width (PE-788)", () => {
  it("fills its container from the base layer, so app widths still win", () => {
    const base = layerBody(globalsCss, "base").replace(/\s+/g, " ");
    expect(base).toContain(`${CHAT_ROOT_SELECTOR} { width: 100%; }`);
  });

  it.each([
    ["welcome screen", { messages: [] }],
    [
      "message view",
      {
        messages: [{ id: "u1", role: "user" as const, content: "hi" }],
      },
    ],
  ])("the %s root matches the width rule", (_label, props) => {
    render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider threadId="t1">
          <CopilotChatView {...props} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    expect(screen.getByTestId("copilot-chat").matches(CHAT_ROOT_SELECTOR)).toBe(
      true,
    );
  });
});
