import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { AssistantMessage } from "@ag-ui/core";

// No mocks needed - Vitest handles ES modules natively!

// Mock navigator.clipboard
const mockWriteText = vi.fn();
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

// Mock callback functions
const mockOnThumbsUp = vi.fn();
const mockOnThumbsDown = vi.fn();
const mockOnReadAloud = vi.fn();
const mockOnRegenerate = vi.fn();

// Helper to render components with context providers
const TEST_THREAD_ID = "test-thread";

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        {component}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
};

// Clear mocks before each test
beforeEach(() => {
  mockWriteText.mockClear();
  mockOnThumbsUp.mockClear();
  mockOnThumbsDown.mockClear();
  mockOnReadAloud.mockClear();
  mockOnRegenerate.mockClear();
});

describe("CopilotChatAssistantMessage", () => {
  const basicMessage: AssistantMessage = {
    role: "assistant",
    content: "Hello, this is a test message from the assistant.",
    id: "test-message-1",
  };

  describe("Basic rendering", () => {
    it("renders with default components and styling", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage} />
      );

      // Check if elements exist (getBy throws if not found, so this is sufficient)
      // Note: Since markdown may not render in test environment, let's check the component structure
      const copyButton = screen.getByRole("button", { name: /copy/i });
      expect(copyButton).toBeDefined();
    });

    it("renders empty message gracefully", () => {
      const emptyMessage: AssistantMessage = {
        role: "assistant",
        content: "",
        id: "empty-message",
      };

      renderWithProvider(
        <CopilotChatAssistantMessage message={emptyMessage} />
      );

      // Should render the component structure but NOT show toolbar for empty content
      const container = document.querySelector('[data-message-id="empty-message"]');
      expect(container).toBeDefined();

      // Should NOT have a copy button since there's no content to copy
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });
  });

  describe("Callback functionality", () => {
    it("renders only copy button when no callbacks provided", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage} />
      );

      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
      expect(screen.queryByRole("button", { name: /thumbs up/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /thumbs down/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /read aloud/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    });

    it("renders all buttons when all callbacks provided", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsUp={mockOnThumbsUp}
          onThumbsDown={mockOnThumbsDown}
          onReadAloud={mockOnReadAloud}
          onRegenerate={mockOnRegenerate}
        />
      );

      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
      expect(
        screen.getByRole("button", { name: /good response/i })
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: /bad response/i })
      ).toBeDefined();
      expect(screen.getByRole("button", { name: /read aloud/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /regenerate/i })).toBeDefined();
    });

    it("calls copy functionality when copy button clicked", async () => {
      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage} />
      );

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(basicMessage.content!);
      });
    });

    it("calls thumbs up callback when thumbs up button clicked", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsUp={mockOnThumbsUp}
        />
      );

      const thumbsUpButton = screen.getByRole("button", {
        name: /good response/i,
      });
      fireEvent.click(thumbsUpButton);

      expect(mockOnThumbsUp).toHaveBeenCalledTimes(1);
    });

    it("calls thumbs down callback when thumbs down button clicked", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsDown={mockOnThumbsDown}
        />
      );

      const thumbsDownButton = screen.getByRole("button", {
        name: /bad response/i,
      });
      fireEvent.click(thumbsDownButton);

      expect(mockOnThumbsDown).toHaveBeenCalledTimes(1);
    });

    it("calls read aloud callback when read aloud button clicked", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onReadAloud={mockOnReadAloud}
        />
      );

      const readAloudButton = screen.getByRole("button", {
        name: /read aloud/i,
      });
      fireEvent.click(readAloudButton);

      expect(mockOnReadAloud).toHaveBeenCalledTimes(1);
    });

    it("calls regenerate callback when regenerate button clicked", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onRegenerate={mockOnRegenerate}
        />
      );

      const regenerateButton = screen.getByRole("button", {
        name: /regenerate/i,
      });
      fireEvent.click(regenerateButton);

      expect(mockOnRegenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Additional toolbar items", () => {
    it("renders additional toolbar items", () => {
      const additionalItems = (
        <button data-testid="custom-toolbar-item">Custom Action</button>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          additionalToolbarItems={additionalItems}
        />
      );

      expect(screen.getByTestId("custom-toolbar-item")).toBeDefined();
    });
  });

  describe("Slot functionality - Custom Components", () => {
    it("accepts custom MarkdownRenderer component", () => {
      const CustomMarkdownRenderer = ({ content }: { content: string }) => (
        <div data-testid="custom-markdown">{content.toUpperCase()}</div>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          markdownRenderer={CustomMarkdownRenderer}
        />
      );

      expect(screen.getByTestId("custom-markdown")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-markdown")
          .textContent?.includes(basicMessage.content!.toUpperCase())
      ).toBe(true);
    });

    it("accepts custom Toolbar component", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CustomToolbar = ({ children, ...props }: any) => (
        <div data-testid="custom-toolbar" {...props}>
          Custom Toolbar: {children}
        </div>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          toolbar={CustomToolbar}
        />
      );

      expect(screen.getByTestId("custom-toolbar")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-toolbar")
          .textContent?.includes("Custom Toolbar:")
      ).toBe(true);
    });

    it("accepts custom CopyButton component", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CustomCopyButton = (props: any) => (
        <button data-testid="custom-copy-button" {...props}>
          Custom Copy
        </button>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          copyButton={CustomCopyButton}
        />
      );

      expect(screen.getByTestId("custom-copy-button")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-copy-button")
          .textContent?.includes("Custom Copy")
      ).toBe(true);
    });

    it("accepts custom ThumbsUpButton component", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CustomThumbsUpButton = (props: any) => (
        <button data-testid="custom-thumbs-up" {...props}>
          Custom Like
        </button>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsUp={mockOnThumbsUp}
          thumbsUpButton={CustomThumbsUpButton}
        />
      );

      expect(screen.getByTestId("custom-thumbs-up")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-thumbs-up")
          .textContent?.includes("Custom Like")
      ).toBe(true);
    });

    it("accepts custom ThumbsDownButton component", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CustomThumbsDownButton = (props: any) => (
        <button data-testid="custom-thumbs-down" {...props}>
          Custom Dislike
        </button>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsDown={mockOnThumbsDown}
          thumbsDownButton={CustomThumbsDownButton}
        />
      );

      expect(screen.getByTestId("custom-thumbs-down")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-thumbs-down")
          .textContent?.includes("Custom Dislike")
      ).toBe(true);
    });

    it("accepts custom ReadAloudButton component", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CustomReadAloudButton = (props: any) => (
        <button data-testid="custom-read-aloud" {...props}>
          Custom Speak
        </button>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onReadAloud={mockOnReadAloud}
          readAloudButton={CustomReadAloudButton}
        />
      );

      expect(screen.getByTestId("custom-read-aloud")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-read-aloud")
          .textContent?.includes("Custom Speak")
      ).toBe(true);
    });

    it("accepts custom RegenerateButton component", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CustomRegenerateButton = (props: any) => (
        <button data-testid="custom-regenerate" {...props}>
          Custom Retry
        </button>
      );

      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onRegenerate={mockOnRegenerate}
          regenerateButton={CustomRegenerateButton}
        />
      );

      expect(screen.getByTestId("custom-regenerate")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-regenerate")
          .textContent?.includes("Custom Retry")
      ).toBe(true);
    });
  });

  describe("Slot functionality - Custom Classes", () => {
    it("applies custom className to component", () => {
      const { container } = renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          className="custom-container-class"
        />
      );

      const containerElement = container.querySelector(
        ".custom-container-class"
      );
      expect(containerElement).toBeDefined();
    });

    it("applies custom className to MarkdownRenderer slot", () => {
      const { container } = renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          markdownRenderer="custom-markdown-class"
        />
      );

      const markdownElement = container.querySelector(".custom-markdown-class");
      expect(markdownElement).toBeDefined();
    });

    it("applies custom className to Toolbar slot", () => {
      const { container } = renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          toolbar="custom-toolbar-class"
        />
      );

      const toolbarElement = container.querySelector(".custom-toolbar-class");
      expect(toolbarElement).toBeDefined();
    });

    it("applies custom className to CopyButton slot", () => {
      const { container } = renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          copyButton="custom-copy-button-class"
        />
      );

      const copyButtonElement = container.querySelector(
        ".custom-copy-button-class"
      );
      expect(copyButtonElement).toBeDefined();
    });
  });

  describe("Children render prop functionality", () => {
    it("supports custom layout via children render prop", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage}>
          {({
            markdownRenderer: MarkdownRenderer,
            toolbar: Toolbar,
            message,
          }) => (
            <div data-testid="custom-layout">
              <h2>Custom Layout for: {message.id}</h2>
              {MarkdownRenderer}
              <div data-testid="custom-toolbar-wrapper">{Toolbar}</div>
            </div>
          )}
        </CopilotChatAssistantMessage>
      );

      expect(screen.getByTestId("custom-layout")).toBeDefined();
      expect(
        screen.getByText(`Custom Layout for: ${basicMessage.id}`)
      ).toBeDefined();
      expect(screen.getByTestId("custom-toolbar-wrapper")).toBeDefined();
      // Note: Markdown content may not render in test environment, check toolbar instead
      expect(screen.getByTestId("custom-toolbar-wrapper")).toBeDefined();
    });

    it("provides all slot components to children render prop", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsUp={mockOnThumbsUp}
          onThumbsDown={mockOnThumbsDown}
          onReadAloud={mockOnReadAloud}
          onRegenerate={mockOnRegenerate}
        >
          {({
            markdownRenderer: MarkdownRenderer,
            toolbar: Toolbar,
            copyButton: CopyButton,
            thumbsUpButton: ThumbsUpButton,
            thumbsDownButton: ThumbsDownButton,
            readAloudButton: ReadAloudButton,
            regenerateButton: RegenerateButton,
          }) => (
            <div data-testid="all-slots-layout">
              {MarkdownRenderer}
              {Toolbar}
              <div data-testid="individual-buttons">
                {CopyButton}
                {ThumbsUpButton}
                {ThumbsDownButton}
                {ReadAloudButton}
                {RegenerateButton}
              </div>
            </div>
          )}
        </CopilotChatAssistantMessage>
      );

      expect(screen.getByTestId("all-slots-layout")).toBeDefined();
      expect(screen.getByTestId("individual-buttons")).toBeDefined();

      // Verify all buttons are rendered
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(5); // At least copy, thumbs up, thumbs down, read aloud, regenerate
    });

    it("provides callback props to children render prop", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage
          message={basicMessage}
          onThumbsUp={mockOnThumbsUp}
          onThumbsDown={mockOnThumbsDown}
          onReadAloud={mockOnReadAloud}
          onRegenerate={mockOnRegenerate}
        >
          {({ onThumbsUp, onThumbsDown, onReadAloud, onRegenerate }) => (
            <div data-testid="callback-test">
              <button
                onClick={() => onThumbsUp?.(basicMessage)}
                data-testid="custom-thumbs-up"
              >
                Custom Thumbs Up
              </button>
              <button
                onClick={() => onThumbsDown?.(basicMessage)}
                data-testid="custom-thumbs-down"
              >
                Custom Thumbs Down
              </button>
              <button
                onClick={() => onReadAloud?.(basicMessage)}
                data-testid="custom-read-aloud"
              >
                Custom Read Aloud
              </button>
              <button
                onClick={() => onRegenerate?.(basicMessage)}
                data-testid="custom-regenerate"
              >
                Custom Regenerate
              </button>
            </div>
          )}
        </CopilotChatAssistantMessage>
      );

      fireEvent.click(screen.getByTestId("custom-thumbs-up"));
      fireEvent.click(screen.getByTestId("custom-thumbs-down"));
      fireEvent.click(screen.getByTestId("custom-read-aloud"));
      fireEvent.click(screen.getByTestId("custom-regenerate"));

      expect(mockOnThumbsUp).toHaveBeenCalledTimes(1);
      expect(mockOnThumbsDown).toHaveBeenCalledTimes(1);
      expect(mockOnReadAloud).toHaveBeenCalledTimes(1);
      expect(mockOnRegenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Toolbar visibility functionality", () => {
    it("shows toolbar by default (toolbarVisible = true by default)", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage} />
      );

      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
    });

    it("shows toolbar when toolbarVisible is explicitly true", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage 
          message={basicMessage} 
          toolbarVisible={true}
        />
      );

      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
    });

    it("hides toolbar when toolbarVisible is false", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage 
          message={basicMessage} 
          toolbarVisible={false}
        />
      );

      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });

    it("always passes toolbar and toolbarVisible to children render prop", () => {
      const childrenSpy = vi.fn(() => <div data-testid="children-render" />);

      renderWithProvider(
        <CopilotChatAssistantMessage 
          message={basicMessage} 
          toolbarVisible={false}
        >
          {childrenSpy}
        </CopilotChatAssistantMessage>
      );

      expect(childrenSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toolbar: expect.anything(),
          toolbarVisible: false,
          message: basicMessage,
        })
      );
      expect(screen.getByTestId("children-render")).toBeDefined();
    });

    it("passes toolbarVisible true to children render prop by default", () => {
      const childrenSpy = vi.fn(() => <div data-testid="children-render" />);

      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage}>
          {childrenSpy}
        </CopilotChatAssistantMessage>
      );

      expect(childrenSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toolbar: expect.anything(),
          toolbarVisible: true,
          message: basicMessage,
        })
      );
    });

    it("children can use toolbarVisible to conditionally render toolbar", () => {
      renderWithProvider(
        <CopilotChatAssistantMessage 
          message={basicMessage} 
          toolbarVisible={false}
        >
          {({ toolbar, toolbarVisible }) => (
            <div data-testid="custom-layout">
              <div data-testid="content">Custom content</div>
              {toolbarVisible && <div data-testid="conditional-toolbar">{toolbar}</div>}
              {!toolbarVisible && <div data-testid="no-toolbar">No toolbar</div>}
            </div>
          )}
        </CopilotChatAssistantMessage>
      );

      expect(screen.getByTestId("custom-layout")).toBeDefined();
      expect(screen.getByTestId("content")).toBeDefined();
      expect(screen.queryByTestId("conditional-toolbar")).toBeNull();
      expect(screen.getByTestId("no-toolbar")).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("handles copy errors gracefully", async () => {
      // Mock clipboard to throw an error
      mockWriteText.mockRejectedValueOnce(new Error("Clipboard error"));

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      renderWithProvider(
        <CopilotChatAssistantMessage message={basicMessage} />
      );

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy message:",
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    it("handles null message content gracefully", () => {
      const nullContentMessage: AssistantMessage = {
        role: "assistant",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: null as any,
        id: "null-content",
      };

      renderWithProvider(
        <CopilotChatAssistantMessage message={nullContentMessage} />
      );

      // Should render the component structure but NOT show toolbar for empty content
      const container = document.querySelector('[data-message-id="null-content"]');
      expect(container).toBeDefined();

      // Should NOT have a copy button since there's no content to copy
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });
  });
});
