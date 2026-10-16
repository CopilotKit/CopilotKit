import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { standardUI } from "../../../generative-ui/standard";

/**
 * With the markdown transport, the streaming reply is the progress signal,
 * so the chat-level cursor hides once the assistant message has text.
 */
describe("chat cursor with the generative UI markdown transport", () => {
  const streaming = [
    { id: "u1", role: "user", content: "hi" },
    { id: "m1", role: "assistant", content: "Here is a plan\n\n```a2ui\n" },
  ] as any[];

  function renderView(transport: "tool" | "markdown", messages: any[]) {
    return render(
      <CopilotKitProvider generativeUI={{ ui: standardUI, transport }}>
        <CopilotChatConfigurationProvider threadId="t">
          <CopilotChatMessageView messages={messages} isRunning />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
  }

  it("hides the pulsing cursor once the assistant reply has text", () => {
    renderView("markdown", streaming);
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("still shows the cursor before any text has arrived", () => {
    renderView("markdown", [{ id: "u1", role: "user", content: "hi" }]);
    expect(screen.queryByTestId("copilot-loading-cursor")).not.toBeNull();
  });

  it("keeps the cursor with the tool transport", () => {
    renderView("tool", streaming);
    expect(screen.queryByTestId("copilot-loading-cursor")).not.toBeNull();
  });
});
