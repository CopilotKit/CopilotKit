/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import type { CopilotChatViewProps } from "../CopilotChatView";
import { CopilotChatInput } from "../CopilotChatInput";
import type { CopilotChatInputProps } from "../CopilotChatInput";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import type { CopilotChatMessageViewProps } from "../CopilotChatMessageView";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 400 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const createMessages = () => [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there! How can I help?" },
  { id: "3", role: "user" as const, content: "Tell me a joke" },
  {
    id: "4",
    role: "assistant" as const,
    content: "Why did the chicken cross the road?",
  },
];

const createSuggestions = () => [
  {
    title: "Tell me more",
    message: "Tell me more about that",
    isLoading: false,
  },
  {
    title: "Another topic",
    message: "Let's talk about something else",
    isLoading: false,
  },
];

function renderView(props: Partial<CopilotChatViewProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotChatView messages={createMessages()} {...props} />
    </TestWrapper>,
  );
}

const messageRoot = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  if (!el) throw new Error(`message ${id} not rendered`);
  return el;
};

// Each slot's own click handling is covered in its component's
// *.slots.e2e.test.tsx file. These tests pin the handlers CopilotChatView
// wires through its slots, plus one deep drill-down per message type.
describe("CopilotChatView onClick Handlers - Drill-Down E2E Tests", () => {
  describe("Level 1: CopilotChatView Direct Slots", () => {
    it("should handle onSelectSuggestion when suggestion is clicked", () => {
      const onSelectSuggestion = vi.fn();
      const suggestions = createSuggestions();
      renderView({ suggestions, onSelectSuggestion });

      fireEvent.click(screen.getByText("Tell me more"));

      expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[0], 0);
    });
  });

  describe("Level 2: CopilotChatInput Drill-Down", () => {
    it("should handle onClick on sendButton via input props drill-down", () => {
      const onClick = vi.fn();
      renderView({
        onSubmitMessage: vi.fn(),
        input: { sendButton: { onClick } },
      });

      // The send button is enabled once the composer holds text.
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Hello" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      expect(onClick).toHaveBeenCalled();
    });

    it("should handle onClick on startTranscribeButton via input props drill-down", () => {
      const onClick = vi.fn();
      const onStartTranscribe = vi.fn();
      renderView({
        onStartTranscribe,
        input: { startTranscribeButton: { onClick } },
      });

      fireEvent.click(screen.getByTestId("copilot-start-transcribe-button"));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onStartTranscribe).not.toHaveBeenCalled();
    });

    it("should handle onClick on addMenuButton via input props drill-down", () => {
      const onClick = vi.fn();
      // The add button is disabled until there is something to add.
      renderView({ onAddFile: vi.fn(), input: { addMenuButton: { onClick } } });

      fireEvent.click(screen.getByTestId("copilot-add-menu-button"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should handle onFocus and onBlur on textArea via input props drill-down", () => {
      const onFocus = vi.fn();
      const onBlur = vi.fn();
      renderView({ input: { textArea: { onFocus, onBlur } } });

      const textarea = screen.getByRole("textbox");
      fireEvent.focus(textarea);
      fireEvent.blur(textarea);

      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });

  describe("Level 2: CopilotChatMessageView Drill-Down", () => {
    it("should handle onClick on assistantMessage container via messageView drill-down", () => {
      const onClick = vi.fn();
      renderView({ messageView: { assistantMessage: { onClick } } });

      fireEvent.click(messageRoot("2"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should handle onClick on userMessage container via messageView drill-down", () => {
      const onClick = vi.fn();
      renderView({ messageView: { userMessage: { onClick } } });

      fireEvent.click(messageRoot("1"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("Level 3: Message Toolbar Drill-Down", () => {
    it("should handle onClick and className on the assistant copyButton via deep drill-down", () => {
      const onClick = vi.fn();
      renderView({
        messageView: {
          assistantMessage: {
            copyButton: { onClick, className: "custom-copy-class" },
          },
        },
      });

      const copyBtn = messageRoot("2").querySelector<HTMLElement>(
        "[data-testid=copilot-copy-button]",
      );
      expect(copyBtn).toHaveClass("custom-copy-class");
      fireEvent.click(copyBtn!);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should handle onClick on entire toolbar via deep drill-down", () => {
      const onClick = vi.fn();
      const { container } = renderView({
        messageView: { assistantMessage: { toolbar: { onClick } } },
      });

      const toolbar = container.querySelector(".cpk-assistant-message-toolbar");
      expect(toolbar).not.toBeNull();
      fireEvent.click(toolbar!);
      expect(onClick).toHaveBeenCalled();
    });

    it("should handle onClick on the user copyButton via deep drill-down", () => {
      const onClick = vi.fn();
      renderView({
        messageView: { userMessage: { copyButton: { onClick } } },
      });

      const copyBtn = messageRoot("1").querySelector<HTMLElement>(
        "[data-testid=copilot-user-copy-button]",
      );
      fireEvent.click(copyBtn!);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should propagate onEditMessage through messageView slot", () => {
      const onEditMessage = vi.fn();
      renderView({ messageView: { userMessage: { onEditMessage } } });

      const editBtn = messageRoot("1").querySelector<HTMLElement>(
        "[data-testid=copilot-edit-button]",
      );
      fireEvent.click(editBtn!);

      expect(onEditMessage).toHaveBeenCalledWith({
        message: expect.objectContaining({ id: "1" }),
      });
    });
  });

  describe("Level 2: SuggestionView Drill-Down", () => {
    it("should handle onClick on suggestion container via drill-down", () => {
      const onClick = vi.fn();
      renderView({
        suggestions: createSuggestions(),
        suggestionView: { container: { onClick } },
      });

      fireEvent.click(screen.getByTestId("copilot-suggestions"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should handle onClick on individual suggestion pills via drill-down", () => {
      const onClick = vi.fn();
      const onSelectSuggestion = vi.fn();
      renderView({
        suggestions: createSuggestions(),
        onSelectSuggestion,
        suggestionView: { suggestion: { onClick } },
      });

      fireEvent.click(screen.getByText("Tell me more"));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSelectSuggestion).not.toHaveBeenCalled();
    });
  });

  describe("Function Render Slot Pattern", () => {
    it("should support passing render function to input slot", () => {
      const CustomInput = (props: CopilotChatInputProps) => (
        <CopilotChatInput {...props} sendButton="custom-send-class" />
      );

      renderView({ input: CustomInput });

      expect(screen.getByTestId("copilot-send-button")).toHaveClass(
        "custom-send-class",
      );
    });

    it("should support passing render function to messageView slot", () => {
      const CustomMessageView = (props: CopilotChatMessageViewProps) => (
        <CopilotChatMessageView {...props} className="custom-message-view" />
      );

      renderView({ messageView: CustomMessageView });

      expect(screen.getByTestId("copilot-message-list")).toHaveClass(
        "custom-message-view",
      );
    });
  });

  describe("Callback Propagation Through Slot Hierarchy", () => {
    it("should propagate onSubmitMessage through input slot", () => {
      const onSubmitMessage = vi.fn();
      renderView({ onSubmitMessage });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmitMessage).toHaveBeenCalledWith("Test message");
    });

    it("should propagate onStop through input slot", () => {
      const onStop = vi.fn();
      renderView({ isRunning: true, onStop });

      fireEvent.click(screen.getByRole("button", { name: "Stop" }));

      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });
});
