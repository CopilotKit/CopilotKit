import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChatView } from "../../components/chat/CopilotChatView";
import { stylesheet } from "@copilotkit/core/styles";

const CHAT_ROOT_SELECTOR = ".copilotKitChat[data-copilotkit]";

// PE-788: the chat root is an inline-size container (`.cpk-chat-view`), so its
// content gives it no intrinsic width. As a flex item in a row (the documented
// <CopilotThreadsDrawer> + <CopilotChat> layout) its auto width resolved to
// 0px. jsdom does no layout, so these tests pin the two halves of the fix: the
// zero-specificity width rule in the shipped stylesheet, and a chat root that
// the rule's selector matches.
describe("CopilotChat root width (PE-788)", () => {
  it("fills its container with a :where() rule, so app widths still win", () => {
    expect(stylesheet).toContain(`:where(${CHAT_ROOT_SELECTOR}){width:100%}`);
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
