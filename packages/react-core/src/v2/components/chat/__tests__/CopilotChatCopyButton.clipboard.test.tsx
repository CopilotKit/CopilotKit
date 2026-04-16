import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { AssistantMessage, UserMessage } from "@ag-ui/core";

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const createAssistantMessage = (content: string): AssistantMessage => ({
  id: "msg-assistant-1",
  role: "assistant",
  content,
});

const createUserMessage = (content: string): UserMessage => ({
  id: "msg-user-1",
  role: "user",
  content,
});

describe("CopyButton clipboard behavior", () => {
  let originalClipboard: Clipboard;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  describe("AssistantMessage CopyButton", () => {
    it("shows copied state only after successful clipboard write", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      const message = createAssistantMessage("Hello assistant");
      render(
        <TestWrapper>
          <CopilotChatAssistantMessage message={message} />
        </TestWrapper>,
      );

      const copyButton = screen.getByTestId("copilot-copy-button");
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("Hello assistant");
      });

      // After successful write, should show check icon
      await waitFor(() => {
        const checkIcon = copyButton.querySelector(".lucide-check");
        expect(checkIcon).not.toBeNull();
      });
    });

    it("does NOT show copied state when clipboard API is unavailable", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const message = createAssistantMessage("Hello assistant");
      render(
        <TestWrapper>
          <CopilotChatAssistantMessage message={message} />
        </TestWrapper>,
      );

      const copyButton = screen.getByTestId("copilot-copy-button");
      fireEvent.click(copyButton);

      // Wait a tick for any async handlers
      await new Promise((r) => setTimeout(r, 50));

      // Should still show copy icon (not check icon)
      const checkIcon = copyButton.querySelector(".lucide-check");
      expect(checkIcon).toBeNull();
      const copyIcon = copyButton.querySelector(".lucide-copy");
      expect(copyIcon).not.toBeNull();
    });

    it("logs error when clipboard write rejects", async () => {
      const writeTextMock = vi
        .fn()
        .mockRejectedValue(new Error("Permission denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const message = createAssistantMessage("Hello assistant");
      render(
        <TestWrapper>
          <CopilotChatAssistantMessage message={message} />
        </TestWrapper>,
      );

      const copyButton = screen.getByTestId("copilot-copy-button");
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy to clipboard:",
          expect.any(Error),
        );
      });

      // Should NOT show copied state when write failed
      const checkIcon = copyButton.querySelector(".lucide-check");
      expect(checkIcon).toBeNull();

      consoleSpy.mockRestore();
    });
  });

  describe("UserMessage CopyButton", () => {
    it("shows copied state only after successful clipboard write", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      const message = createUserMessage("Hello user");
      render(
        <TestWrapper>
          <CopilotChatUserMessage message={message} />
        </TestWrapper>,
      );

      const copyButton = screen.getByTestId("copilot-user-copy-button");
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("Hello user");
      });

      await waitFor(() => {
        const checkIcon = copyButton.querySelector(".lucide-check");
        expect(checkIcon).not.toBeNull();
      });
    });

    it("does NOT show copied state when clipboard API is unavailable", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const message = createUserMessage("Hello user");
      render(
        <TestWrapper>
          <CopilotChatUserMessage message={message} />
        </TestWrapper>,
      );

      const copyButton = screen.getByTestId("copilot-user-copy-button");
      fireEvent.click(copyButton);

      await new Promise((r) => setTimeout(r, 50));

      const checkIcon = copyButton.querySelector(".lucide-check");
      expect(checkIcon).toBeNull();
      const copyIcon = copyButton.querySelector(".lucide-copy");
      expect(copyIcon).not.toBeNull();
    });

    it("logs error when clipboard write rejects", async () => {
      const writeTextMock = vi
        .fn()
        .mockRejectedValue(new Error("Permission denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const message = createUserMessage("Hello user");
      render(
        <TestWrapper>
          <CopilotChatUserMessage message={message} />
        </TestWrapper>,
      );

      const copyButton = screen.getByTestId("copilot-user-copy-button");
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy to clipboard:",
          expect.any(Error),
        );
      });

      // Should NOT show copied state when write failed
      const checkIcon = copyButton.querySelector(".lucide-check");
      expect(checkIcon).toBeNull();

      consoleSpy.mockRestore();
    });
  });
});
