import { defineComponent } from "vue";
import { render, screen, fireEvent, waitFor } from "@testing-library/vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AssistantMessage, UserMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

const TEST_THREAD_ID = "test-thread";

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

const renderAssistantMessage = (message: AssistantMessage) => {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatAssistantMessage,
    },
    setup() {
      return { message, TEST_THREAD_ID };
    },
    template: `
      <CopilotKitProvider runtime-url="/api/copilotkit">
        <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
          <CopilotChatAssistantMessage :message="message" />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
};

const renderUserMessage = (message: UserMessage) => {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatUserMessage,
    },
    setup() {
      return { message, TEST_THREAD_ID };
    },
    template: `
      <CopilotKitProvider runtime-url="/api/copilotkit">
        <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
          <CopilotChatUserMessage :message="message" />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
};

describe("CopyButton clipboard behavior", () => {
  let originalClipboard: Clipboard | undefined;

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

      renderAssistantMessage(createAssistantMessage("Hello assistant"));

      const copyButton = screen.getByTestId("copilot-copy-button");
      await fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("Hello assistant");
      });
      await waitFor(() => {
        expect(copyButton.querySelector(".lucide-check")).not.toBeNull();
      });
    });

    it("does NOT show copied state when clipboard API is unavailable", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      renderAssistantMessage(createAssistantMessage("Hello assistant"));

      const copyButton = screen.getByTestId("copilot-copy-button");
      await fireEvent.click(copyButton);

      await waitFor(() => {
        expect(copyButton.querySelector(".lucide-check")).toBeNull();
        expect(copyButton.querySelector(".lucide-copy")).not.toBeNull();
      });
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

      renderAssistantMessage(createAssistantMessage("Hello assistant"));

      const copyButton = screen.getByTestId("copilot-copy-button");
      await fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("Hello assistant");
      });
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy to clipboard:",
          expect.any(Error),
        );
      });
      expect(copyButton.querySelector(".lucide-check")).toBeNull();
      expect(copyButton.querySelector(".lucide-copy")).not.toBeNull();

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

      renderUserMessage(createUserMessage("Hello user"));

      const copyButton = screen.getByTestId("copilot-user-copy-button");
      await fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("Hello user");
      });
      await waitFor(() => {
        expect(copyButton.querySelector(".lucide-check")).not.toBeNull();
      });
    });

    it("does NOT show copied state when clipboard API is unavailable", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      renderUserMessage(createUserMessage("Hello user"));

      const copyButton = screen.getByTestId("copilot-user-copy-button");
      await fireEvent.click(copyButton);

      await waitFor(() => {
        expect(copyButton.querySelector(".lucide-check")).toBeNull();
        expect(copyButton.querySelector(".lucide-copy")).not.toBeNull();
      });
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

      renderUserMessage(createUserMessage("Hello user"));

      const copyButton = screen.getByTestId("copilot-user-copy-button");
      await fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("Hello user");
      });
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy to clipboard:",
          expect.any(Error),
        );
      });
      expect(copyButton.querySelector(".lucide-check")).toBeNull();
      expect(copyButton.querySelector(".lucide-copy")).not.toBeNull();

      consoleSpy.mockRestore();
    });
  });
});
