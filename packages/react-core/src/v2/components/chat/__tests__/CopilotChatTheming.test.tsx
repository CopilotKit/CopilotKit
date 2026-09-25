import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import type { AssistantMessage } from "@ag-ui/core";

const TEST_THREAD_ID = "test-thread";

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        {component}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
};

// These tests guard the chat theming contract: each themeable element must keep
// reading its dedicated `--cpk-*` custom property. The defaults for those
// properties live in globals.css and match the colors the chat has always
// shipped, so the default appearance is unchanged. jsdom does not evaluate the
// Tailwind build, so we assert the var-driven utility class is present rather
// than a computed color. Removing one of these classes (e.g. hardcoding a color
// again) would break the documented override and fail here.
describe("v2 CopilotChat theming hooks", () => {
  describe("CopilotChatInput", () => {
    it("input pill reads --cpk-input-background", () => {
      renderWithProvider(<CopilotChatInput />);
      const el = screen.getByTestId("copilot-chat-input");
      expect(el.className).toContain("bg-[var(--cpk-input-background)]");
    });

    it("send button reads --cpk-send-button-* properties", () => {
      renderWithProvider(<CopilotChatInput value="hello" />);
      const el = screen.getByTestId("copilot-send-button");
      expect(el.className).toContain("bg-[var(--cpk-send-button-background)]");
      expect(el.className).toContain(
        "text-[var(--cpk-send-button-foreground)]",
      );
    });

    it("toolbar button reads --cpk-toolbar-button-foreground", () => {
      renderWithProvider(<CopilotChatInput />);
      const el = screen.getByTestId("copilot-add-menu-button");
      expect(el.className).toContain(
        "text-[var(--cpk-toolbar-button-foreground)]",
      );
    });
  });

  describe("CopilotChatAssistantMessage", () => {
    it("message toolbar button reads --cpk-message-toolbar-button-foreground", () => {
      const message: AssistantMessage = {
        role: "assistant",
        content: "Hello from the assistant",
        id: "test-assistant-1",
      };

      renderWithProvider(<CopilotChatAssistantMessage message={message} />);

      const el = screen.getByTestId("copilot-copy-button");
      expect(el.className).toContain(
        "text-[var(--cpk-message-toolbar-button-foreground)]",
      );
    });
  });
});
