import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

// Mock onSubmitMessage function to track calls
const mockOnSubmitMessage = vi.fn();

const TEST_THREAD_ID = "test-thread";

// Helper to render components with context provider
const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
      {component}
    </CopilotChatConfigurationProvider>
  );
};

const getSendButton = (container: HTMLElement) =>
  container.querySelector("svg.lucide-arrow-up")?.closest("button") as HTMLButtonElement | null;

const getAddMenuButton = (container: HTMLElement) =>
  container.querySelector("svg.lucide-plus")?.closest("button") as HTMLButtonElement | null;

const mockLayoutMetrics = (
  container: HTMLElement,
  options?: { gridWidth?: number; addWidth?: number; actionsWidth?: number }
) => {
  const grid = container.querySelector("div.grid") as HTMLElement | null;
  if (!grid) {
    throw new Error("Grid container not found in CopilotChatInput layout");
  }

  const { gridWidth = 640, addWidth = 48, actionsWidth = 96 } = options ?? {};

  Object.defineProperty(grid, "clientWidth", {
    value: gridWidth,
    configurable: true,
  });

  const rectFactory = (width: number) =>
    () => ({
      width,
      height: 40,
      top: 0,
      left: 0,
      right: width,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

  const addContainer = grid.children[0] as HTMLElement;
  const actionsContainer = grid.children[2] as HTMLElement;

  Object.defineProperty(addContainer, "getBoundingClientRect", {
    value: rectFactory(addWidth),
    configurable: true,
  });

  Object.defineProperty(actionsContainer, "getBoundingClientRect", {
    value: rectFactory(actionsWidth),
    configurable: true,
  });
};

// Mock scrollHeight for textareas since jsdom doesn't support it properly
Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
  configurable: true,
  get: function (this: HTMLTextAreaElement) {
    const text = this.value || "";

    // Calculate lines based on explicit newlines
    const explicitLines = text.split("\n").length;

    // Simulate text wrapping for long lines (rough approximation)
    // Assume ~50 characters per line as a rough width threshold
    let wrappedLines = 0;
    text.split("\n").forEach((line) => {
      const lineWraps = Math.ceil(line.length / 50);
      wrappedLines += Math.max(1, lineWraps);
    });

    const totalLines = Math.max(explicitLines, wrappedLines);
    return totalLines * 24; // 24px per line
  },
});

// Clear mocks before each test
beforeEach(() => {
  mockOnSubmitMessage.mockClear();
});

describe("CopilotChatInput", () => {
  it("renders with default components and styling", () => {
    const mockOnChange = vi.fn();
    const { container } = renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = getSendButton(container);

    expect(input).toBeDefined();
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true); // Should be disabled when input is empty
  });

  it("calls onSubmitMessage with trimmed text when Enter is pressed", () => {
    const mockOnChange = vi.fn();
    renderWithProvider(
      <CopilotChatInput
        value="  hello world  "
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello world");
  });

  it("calls onSubmitMessage when button is clicked", () => {
    const mockOnChange = vi.fn();
    const { container } = renderWithProvider(
      <CopilotChatInput
        value="test message"
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    const sendButton = getSendButton(container);
    expect(sendButton).not.toBeNull();
    fireEvent.click(sendButton!);

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
  });

  it("manages text state internally when uncontrolled", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />
    );

    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = getSendButton(container);

    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(sendButton!);

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send when Enter is pressed with Shift key", () => {
    const mockOnChange = vi.fn();
    renderWithProvider(
      <CopilotChatInput
        value="test"
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    const input = screen.getByPlaceholderText("Type a message...");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(mockOnSubmitMessage).not.toHaveBeenCalled();
  });

  it("does not send empty or whitespace-only messages", () => {
    const mockOnChange = vi.fn();

    // Test empty string
    const { container, rerender } = renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    let sendButton = getSendButton(container);
    fireEvent.click(sendButton!);
    expect(mockOnSubmitMessage).not.toHaveBeenCalled();

    // Test whitespace only
    rerender(
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        <CopilotChatInput
          value="   "
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      </CopilotChatConfigurationProvider>
    );
    sendButton = getSendButton(container);
    fireEvent.click(sendButton!);
    expect(mockOnSubmitMessage).not.toHaveBeenCalled();
  });

  it("keeps input value when no submit handler is provided", () => {
    renderWithProvider(<CopilotChatInput />);

    const input = screen.getByPlaceholderText("Type a message...");

    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect((input as HTMLTextAreaElement).value).toBe("draft");
  });

  it("enables button based on value prop", () => {
    const mockOnChange = vi.fn();

    // Test with empty value
    const { container, rerender } = renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    let sendButton = getSendButton(container);
    expect(sendButton?.disabled).toBe(true);

    // Test with non-empty value
    rerender(
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        <CopilotChatInput
          value="hello"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      </CopilotChatConfigurationProvider>
    );
    sendButton = getSendButton(container);
    expect(sendButton?.disabled).toBe(false);

    // Test with empty value again
    rerender(
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        <CopilotChatInput
          value=""
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      </CopilotChatConfigurationProvider>
    );
    sendButton = getSendButton(container);
    expect(sendButton?.disabled).toBe(true);
  });

  it("accepts custom slot classes", () => {
    const mockOnChange = vi.fn();
    const { container } = renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
        className="custom-container"
        textArea="custom-textarea"
        sendButton="custom-button"
      />
    );

    const containerDiv = container.firstChild as HTMLElement;
    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = getSendButton(container);

    expect(containerDiv.classList.contains("custom-container")).toBe(true);
    expect(input.classList.contains("custom-textarea")).toBe(true);
    expect(sendButton?.classList.contains("custom-button")).toBe(true);
  });

  it("accepts custom components via slots", () => {
    const mockOnChange = vi.fn();
    const CustomButton = (
      props: React.ButtonHTMLAttributes<HTMLButtonElement>
    ) => (
      <button {...props} data-testid="custom-button">
        Send Now
      </button>
    );

    renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
        sendButton={CustomButton}
      />
    );

    const customButton = screen.getByTestId("custom-button");
    expect(customButton).toBeDefined();
    expect(customButton.textContent?.includes("Send Now")).toBe(true);
  });

  it("supports custom layout via children render prop", () => {
    const mockOnChange = vi.fn();
    renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={mockOnChange}
        onSubmitMessage={mockOnSubmitMessage}
      >
        {({ textArea: TextArea, sendButton: SendButton }) => (
          <div data-testid="custom-layout">
            Custom Layout:
            {SendButton}
            {TextArea}
          </div>
        )}
      </CopilotChatInput>
    );

    const customLayout = screen.getByTestId("custom-layout");
    expect(customLayout).toBeDefined();
    expect(customLayout.textContent?.includes("Custom Layout:")).toBe(true);
  });

  it("updates its internal layout data attribute when content expands", async () => {
    renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />
    );

    const textarea = screen.getByRole("textbox");
    const grid = textarea.closest("[data-layout]") as HTMLElement | null;
    expect(grid?.getAttribute("data-layout")).toBe("compact");

    fireEvent.change(textarea, { target: { value: "line one\nline two" } });

    await waitFor(() => {
      expect(grid?.getAttribute("data-layout")).toBe("expanded");
    });
  });

  it("executes slash commands via keyboard selection", async () => {
    const handleFirst = vi.fn();
    const handleSecond = vi.fn();

    renderWithProvider(
      <CopilotChatInput
        onSubmitMessage={mockOnSubmitMessage}
        toolsMenu={[
          { label: "Say hi", action: handleFirst },
          { label: "Open docs", action: handleSecond },
        ]}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    expect(menu).not.toBeNull();
    expect(screen.queryByText("Say hi")).not.toBeNull();
    expect(screen.queryByText("Open docs")).not.toBeNull();

    fireEvent.keyDown(textarea, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", keyCode: 13 });

    expect(handleSecond).toHaveBeenCalledTimes(1);
    expect(handleFirst).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByTestId("copilot-slash-menu")).toBeNull();
    });

    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("prioritizes prefix matches when filtering slash commands", async () => {
    renderWithProvider(
      <CopilotChatInput
        onSubmitMessage={mockOnSubmitMessage}
        toolsMenu={[
          { label: "Reopen previous chat", action: vi.fn() },
          { label: "Open CopilotKit", action: vi.fn() },
          { label: "Help me operate", action: vi.fn() },
        ]}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/op" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    const options = within(menu).getAllByRole("option");

    expect(options[0]?.textContent?.includes("Open CopilotKit")).toBe(true);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(textarea, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    await waitFor(() => {
      const updated = within(menu).getAllByRole("option");
      expect(updated[1]?.getAttribute("aria-selected")).toBe("true");
    });

    fireEvent.change(textarea, { target: { value: "/ope" } });

    await waitFor(() => {
      const updatedOptions = within(menu).getAllByRole("option");
      expect(updatedOptions[0]?.getAttribute("aria-selected")).toBe("true");
      expect(updatedOptions[0]?.textContent?.startsWith("Open CopilotKit")).toBe(true);
    });
  });

  it("limits slash menu height when commands exceed five items", async () => {
    const tools = Array.from({ length: 6 }, (_, index) => ({
      label: `Command ${index + 1}`,
      action: vi.fn(),
    }));

    renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} toolsMenu={tools} />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/" } });

    const menu = await screen.findByTestId("copilot-slash-menu");

    await waitFor(() => {
      expect(menu.style.maxHeight).toBe("200px");
    });

    const options = within(menu).getAllByRole("option");
    expect(options.length).toBe(6);
  });

  it("allows slash command actions to populate the input", async () => {
    const greeting = "Hello Copilot! 👋 Could you help me with something?";
    const label = "Say hi to CopilotKit";

    renderWithProvider(
      <CopilotChatInput
        onSubmitMessage={mockOnSubmitMessage}
        toolsMenu={[
          {
            label,
            action: () => {
              const textareaElement = document.querySelector<HTMLTextAreaElement>("textarea");
              if (!textareaElement) {
                return;
              }

              const nativeSetter =
                Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
              nativeSetter?.call(textareaElement, greeting);
              textareaElement.dispatchEvent(new Event("input", { bubbles: true }));
            },
          },
        ]}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/" } });

    const option = await screen.findByRole("option", { name: label });
    fireEvent.mouseDown(option);

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(greeting);
    });
  });

  it("shows cancel and finish buttons in transcribe mode", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput
        mode="transcribe"
        onSubmitMessage={mockOnSubmitMessage}
        onStartTranscribe={() => {}}
        onCancelTranscribe={() => {}}
        onFinishTranscribe={() => {}}
        onAddFile={() => {}}
      />
    );

    // Should show cancel button (X icon) - find by svg class
    const cancelIcon = container.querySelector("svg.lucide-x");
    expect(cancelIcon).toBeDefined();

    // Should show finish button (checkmark icon) - find by svg class
    const finishIcon = container.querySelector("svg.lucide-check");
    expect(finishIcon).toBeDefined();

    // Should show cancel button (X icon) and finish button (check icon)
    const cancelButton = container.querySelector("svg.lucide-x");
    const finishButton = container.querySelector("svg.lucide-check");
    expect(cancelButton).toBeDefined();
    expect(finishButton).toBeDefined();

    // Should NOT show transcribe button (mic icon) in transcribe mode
    const transcribeIcon = container.querySelector("svg.lucide-mic");
    expect(transcribeIcon).toBeNull();

    // Should NOT show send button (arrow-up icon) in transcribe mode
    const sendIcon = container.querySelector("svg.lucide-arrow-up");
    expect(sendIcon).toBeNull();
  });

  it("disables add menu button in transcribe mode", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput
        mode="transcribe"
        onSubmitMessage={mockOnSubmitMessage}
        onStartTranscribe={() => {}}
        onCancelTranscribe={() => {}}
        onFinishTranscribe={() => {}}
        onAddFile={() => {}}
        toolsMenu={[{ label: "Test Tool", action: () => {} }]}
      />
    );

    // Add button should be disabled (find by Plus icon)
    const addIcon = container.querySelector("svg.lucide-plus");
    const addButton = addIcon?.closest("button") as HTMLButtonElement | null;
    expect(addButton).not.toBeNull();
    expect(addButton?.disabled).toBe(true);
  });

  it("shows recording indicator instead of textarea in transcribe mode", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput
        mode="transcribe"
        onSubmitMessage={mockOnSubmitMessage}
        onStartTranscribe={() => {}}
        onCancelTranscribe={() => {}}
        onFinishTranscribe={() => {}}
        onAddFile={() => {}}
      />
    );

    // Should show recording indicator (canvas element)
    const recordingIndicator = container.querySelector("canvas");
    expect(recordingIndicator).toBeDefined();

    // Should NOT show textarea in transcribe mode
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows textarea in input mode", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput
        mode="input"
        onSubmitMessage={mockOnSubmitMessage}
        onStartTranscribe={() => {}}
        onCancelTranscribe={() => {}}
        onFinishTranscribe={() => {}}
        onAddFile={() => {}}
      />
    );

    // Should show textarea in input mode
    expect(screen.getByRole("textbox")).toBeDefined();

    // Should NOT show recording indicator (red div)
    const recordingIndicator = container.querySelector(".bg-red-500");
    expect(recordingIndicator).toBeNull();
  });

  it("positions the textarea next to the add menu button when single line", () => {
    renderWithProvider(<CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />);

    const textarea = screen.getByRole("textbox");
    const layoutCell = textarea.parentElement as HTMLElement;
    const gridContainer = layoutCell?.parentElement as HTMLElement;

    expect(layoutCell.className).toContain("col-start-2");
    expect(layoutCell.className).not.toContain("col-span-3");
    expect(gridContainer.className).toContain("items-center");
  });

  it("toggles textarea padding based on multiline state", async () => {
    const { container } = renderWithProvider(<CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />);

    mockLayoutMetrics(container);

    const textarea = screen.getByRole("textbox");
    expect(textarea.className).toContain("pr-5");
    expect(textarea.className).not.toContain("px-5");

    fireEvent.change(textarea, { target: { value: "a very long line that should wrap once it exceeds the width of the input" } });

    await waitFor(() => {
      expect(textarea.className).toContain("px-5");
      expect(textarea.className).not.toContain("pr-5");
    });
  });

  it("returns to the compact layout when text no longer needs extra space", async () => {
    const { container } = renderWithProvider(<CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />);

    mockLayoutMetrics(container);

    const textarea = screen.getByRole("textbox");
    const layoutCell = textarea.parentElement as HTMLElement;

    fireEvent.change(textarea, {
      target: {
        value:
          "this is a very long line that should expand the layout before it wraps so we can see the stacked arrangement",
      },
    });

    await waitFor(() => {
      expect(layoutCell.className).toContain("col-span-3");
    });

    fireEvent.change(textarea, { target: { value: "short" } });

    await waitFor(() => {
      expect(layoutCell.className).toContain("col-start-2");
      expect(layoutCell.className).not.toContain("col-span-3");
    });
  });

  it("moves the textarea above the add menu button when multiple lines", async () => {
    renderWithProvider(<CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />);

    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "first line\nsecond line" } });

    await waitFor(() => {
      const layoutCell = textarea.parentElement as HTMLElement;
      expect(layoutCell.className).toContain("col-span-3");
      expect(layoutCell.className).not.toContain("col-start-2");
    });
  });

  it("disables the add menu button when no menu items are provided", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />
    );

    const addButton = getAddMenuButton(container);

    expect(addButton).not.toBeNull();
    expect(addButton?.disabled).toBe(true);
  });

  it("opens the add menu and runs onAddFile when the default item is clicked", async () => {
    const handleAddFile = vi.fn();

    const { container } = renderWithProvider(
      <CopilotChatInput onAddFile={handleAddFile} onSubmitMessage={mockOnSubmitMessage} />
    );

    mockLayoutMetrics(container);

    const addButton = getAddMenuButton(container);
    expect(addButton).not.toBeNull();
    expect(addButton?.disabled).toBe(false);

    const user = userEvent.setup();
    await user.click(addButton!);

    await waitFor(() => {
      expect(addButton?.getAttribute("data-state")).toBe("open");
    });

    const menuItem = await screen.findByRole("menuitem", { name: "Add photos or files" });
    fireEvent.click(menuItem);

    expect(handleAddFile).toHaveBeenCalledTimes(1);
  });

  it("renders additional custom menu items from the tools menu", async () => {
    const handleCustom = vi.fn();

    const { container } = renderWithProvider(
      <CopilotChatInput
        toolsMenu={[
          { label: "Custom action", action: handleCustom },
        ]}
        onSubmitMessage={mockOnSubmitMessage}
      />
    );

    mockLayoutMetrics(container);

    const addButton = getAddMenuButton(container);
    expect(addButton).not.toBeNull();
    const user = userEvent.setup();
    await user.click(addButton!);

    await waitFor(() => {
      expect(addButton?.getAttribute("data-state")).toBe("open");
    });

    const menuItem = await screen.findByRole("menuitem", { name: "Custom action" });
    fireEvent.click(menuItem);

    expect(handleCustom).toHaveBeenCalledTimes(1);
  });

  // Controlled component tests
  describe("Controlled component behavior", () => {
    it("displays the provided value prop", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      renderWithProvider(
        <CopilotChatInput
          value="test value"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("test value");
    });

    it("calls onChange when user types", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      renderWithProvider(
        <CopilotChatInput
          value=""
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "new text" } });

      expect(mockOnChange).toHaveBeenCalledWith("new text");
    });

    it("calls onSubmitMessage when form is submitted", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      renderWithProvider(
        <CopilotChatInput
          value="hello world"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello world");
    });

    it("calls onSubmitMessage when send button is clicked", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput
          value="test message"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const sendButton = getSendButton(container);
      expect(sendButton).not.toBeNull();
      fireEvent.click(sendButton!);

      expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
    });

    it("trims whitespace when submitting", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      renderWithProvider(
        <CopilotChatInput
          value="  hello world  "
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello world");
    });

    it("does not submit empty or whitespace-only messages", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput
          value="   "
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const sendButton = getSendButton(container);
      expect(sendButton).not.toBeNull();
      fireEvent.click(sendButton!);

      expect(mockOnSubmitMessage).not.toHaveBeenCalled();
    });

    it("disables send button when onSubmitMessage is not provided", () => {
      const mockOnChange = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput value="some text" onChange={mockOnChange} />
      );

      const sendButton = getSendButton(container);
      expect(sendButton?.disabled).toBe(true);
    });

    it("disables send button when value is empty", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput
          value=""
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const sendButton = getSendButton(container);
      expect(sendButton?.disabled).toBe(true);
    });

    it("enables send button when value has content and onSubmitMessage is provided", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput
          value="hello"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const sendButton = getSendButton(container);
      expect(sendButton?.disabled).toBe(false);
    });

    it("works as a fully controlled component", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { rerender } = renderWithProvider(
        <CopilotChatInput
          value="initial"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("initial");

      // Simulate parent component updating the value
      rerender(
        <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
          <CopilotChatInput
            value="updated"
            onChange={mockOnChange}
            onSubmitMessage={mockOnSubmitMessage}
          />
        </CopilotChatConfigurationProvider>
      );

      expect((input as HTMLTextAreaElement).value).toBe("updated");
    });

    it("does not clear input after submission when controlled", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput
          value="test message"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />
      );

      const input = screen.getByRole("textbox");
      const sendButton = getSendButton(container);

      fireEvent.click(sendButton!);

      // In controlled mode, the component should not clear the input
      // It's up to the parent to manage the value
      expect((input as HTMLTextAreaElement).value).toBe("test message");
      expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
    });
  });
});
