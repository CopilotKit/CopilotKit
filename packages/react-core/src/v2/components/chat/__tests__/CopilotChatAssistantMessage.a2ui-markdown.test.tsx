import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";

const FENCE =
  '```a2ui\n{"version":"v0.9","createSurface":{"surfaceId":"s"}}\n{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"Surface text"}]}}\n```';

function renderIn(mode: "tool" | "markdown", content: string) {
  return render(
    <CopilotKitProvider a2ui={{ mode }}>
      <CopilotChatConfigurationProvider threadId="t">
        <CopilotChatAssistantMessage
          message={{ id: "m1", role: "assistant", content }}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

describe("CopilotChatAssistantMessage with a2ui markdown mode", () => {
  it("renders the fence as a surface in markdown mode", async () => {
    renderIn("markdown", `Before\n\n${FENCE}\n\nAfter`);
    expect(await screen.findByText("Surface text")).toBeTruthy();
    expect(
      document.querySelector("[data-a2ui-markdown-surface]"),
    ).not.toBeNull();
  });

  it("fence is plain code in tool mode", async () => {
    renderIn("tool", FENCE);
    // Streamdown lazy-loads its code-block body, so wait for the <code> element.
    await waitFor(() => expect(document.querySelector("code")).not.toBeNull(), {
      timeout: 5000,
    });
    expect(document.querySelector("[data-a2ui-markdown-surface]")).toBeNull();
  });
});

describe("A2UI markdown mode fade-in styles", () => {
  it("injects the fade-in keyframes once a surface renders", async () => {
    renderIn("markdown", FENCE);
    await screen.findByText("Surface text");
    const style = document.getElementById("a2ui-markdown-fade");
    expect(style?.textContent).toContain("@keyframes a2ui-fade-in");
    expect(document.querySelector("[data-a2ui-visible]")).not.toBeNull();
  });
});

describe("chat cursor in A2UI markdown mode", () => {
  const streaming = [
    { id: "u1", role: "user", content: "hi" },
    { id: "m1", role: "assistant", content: "Here is a plan\n\n```a2ui\n" },
  ] as any[];

  function renderView(mode: "tool" | "markdown", messages: any[]) {
    return render(
      <CopilotKitProvider a2ui={{ mode }}>
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

  it("keeps the cursor in tool mode", () => {
    renderView("tool", streaming);
    expect(screen.queryByTestId("copilot-loading-cursor")).not.toBeNull();
  });
});
