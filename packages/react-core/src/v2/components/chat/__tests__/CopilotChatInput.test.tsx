import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
    </CopilotChatConfigurationProvider>,
  );
};

const getSendButton = (container: HTMLElement) =>
  container
    .querySelector("svg.lucide-arrow-up")
    ?.closest("button") as HTMLButtonElement | null;

const getAddMenuButton = (container: HTMLElement) =>
  container
    .querySelector("svg.lucide-plus")
    ?.closest("button") as HTMLButtonElement | null;

const getLayoutGrid = (textarea: HTMLElement) =>
  textarea.closest("[data-layout]") as HTMLElement;

const mockLayoutMetrics = (
  container: HTMLElement,
  options?: { gridWidth?: number; addWidth?: number; actionsWidth?: number },
) => {
  const grid = container.querySelector("div.cpk\\:grid") as HTMLElement | null;
  if (!grid) {
    throw new Error("Grid container not found in CopilotChatInput layout");
  }

  const { gridWidth = 640, addWidth = 48, actionsWidth = 96 } = options ?? {};

  Object.defineProperty(grid, "clientWidth", {
    value: gridWidth,
    configurable: true,
  });

  const rectFactory = (width: number) => () => ({
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
      />,
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
      />,
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
      />,
    );

    const sendButton = getSendButton(container);
    expect(sendButton).not.toBeNull();
    fireEvent.click(sendButton!);

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
  });

  it("manages text state internally when uncontrolled", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
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
      />,
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
      />,
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
      </CopilotChatConfigurationProvider>,
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
      />,
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
      </CopilotChatConfigurationProvider>,
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
      </CopilotChatConfigurationProvider>,
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
      />,
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
      props: React.ButtonHTMLAttributes<HTMLButtonElement>,
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
      />,
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
      </CopilotChatInput>,
    );

    const customLayout = screen.getByTestId("custom-layout");
    expect(customLayout).toBeDefined();
    expect(customLayout.textContent?.includes("Custom Layout:")).toBe(true);
  });

  it("passes containerRef to children render prop", () => {
    const ref = React.createRef<HTMLDivElement>();
    renderWithProvider(
      <CopilotChatInput
        value=""
        onChange={vi.fn()}
        onSubmitMessage={mockOnSubmitMessage}
        containerRef={ref}
      >
        {({ containerRef }) => (
          <div ref={containerRef} data-testid="custom-container">
            Custom Container
          </div>
        )}
      </CopilotChatInput>,
    );

    const container = screen.getByTestId("custom-container");
    expect(container).toBeDefined();
    expect(ref.current).toBe(container);
  });

  it("updates its internal layout data attribute when content expands", async () => {
    renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
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
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    expect(menu).not.toBeNull();
    expect(screen.queryByText("Say hi")).not.toBeNull();
    expect(screen.queryByText("Open docs")).not.toBeNull();

    fireEvent.keyDown(textarea, {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
    });
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
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/op" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    const options = within(menu).getAllByRole("option");

    expect(options[0]?.textContent?.includes("Open CopilotKit")).toBe(true);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(textarea, {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
    });
    await waitFor(() => {
      const updated = within(menu).getAllByRole("option");
      expect(updated[1]?.getAttribute("aria-selected")).toBe("true");
    });

    fireEvent.change(textarea, { target: { value: "/ope" } });

    await waitFor(() => {
      const updatedOptions = within(menu).getAllByRole("option");
      expect(updatedOptions[0]?.getAttribute("aria-selected")).toBe("true");
      expect(
        updatedOptions[0]?.textContent?.startsWith("Open CopilotKit"),
      ).toBe(true);
    });
  });

  it("limits slash menu height when commands exceed five items", async () => {
    const tools = Array.from({ length: 6 }, (_, index) => ({
      label: `Command ${index + 1}`,
      action: vi.fn(),
    }));

    renderWithProvider(
      <CopilotChatInput
        onSubmitMessage={mockOnSubmitMessage}
        toolsMenu={tools}
      />,
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
              const textareaElement =
                document.querySelector<HTMLTextAreaElement>("textarea");
              if (!textareaElement) {
                return;
              }

              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value",
              )?.set;
              nativeSetter?.call(textareaElement, greeting);
              textareaElement.dispatchEvent(
                new Event("input", { bubbles: true }),
              );
            },
          },
        ]}
      />,
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
      />,
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
      />,
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
      />,
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
      />,
    );

    // Should show textarea in input mode
    expect(screen.getByRole("textbox")).toBeDefined();

    // Should NOT show recording indicator (red div)
    const recordingIndicator = container.querySelector(".bg-red-500");
    expect(recordingIndicator).toBeNull();
  });

  it("positions the textarea next to the add menu button when single line", () => {
    renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
    );

    const textarea = screen.getByRole("textbox");
    const layoutCell = textarea.parentElement as HTMLElement;
    const gridContainer = layoutCell?.parentElement as HTMLElement;

    expect(layoutCell.className).toContain("col-start-2");
    expect(layoutCell.className).not.toContain("col-span-3");
    expect(gridContainer.className).toContain("items-center");
  });

  it("toggles textarea padding based on multiline state", async () => {
    const { container } = renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
    );

    mockLayoutMetrics(container);

    const textarea = screen.getByRole("textbox");
    expect(textarea.className).toContain("pr-5");
    expect(textarea.className).not.toContain("px-5");

    fireEvent.change(textarea, {
      target: {
        value:
          "a very long line that should wrap once it exceeds the width of the input",
      },
    });

    await waitFor(() => {
      expect(textarea.className).toContain("px-5");
      expect(textarea.className).not.toContain("pr-5");
    });
  });

  it("returns to the compact layout when text no longer needs extra space", async () => {
    const { container } = renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
    );

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
    renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
    );

    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, {
      target: { value: "first line\nsecond line" },
    });

    await waitFor(() => {
      const layoutCell = textarea.parentElement as HTMLElement;
      expect(layoutCell.className).toContain("col-span-3");
      expect(layoutCell.className).not.toContain("col-start-2");
    });
  });

  it("disables the add menu button when no menu items are provided", () => {
    const { container } = renderWithProvider(
      <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
    );

    const addButton = getAddMenuButton(container);

    expect(addButton).not.toBeNull();
    expect(addButton?.disabled).toBe(true);
  });

  it("opens the add menu and runs onAddFile when the default item is clicked", async () => {
    const handleAddFile = vi.fn();

    const { container } = renderWithProvider(
      <CopilotChatInput
        onAddFile={handleAddFile}
        onSubmitMessage={mockOnSubmitMessage}
      />,
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

    const menuItem = await screen.findByRole("menuitem", {
      name: "Add attachments",
    });
    fireEvent.click(menuItem);

    expect(handleAddFile).toHaveBeenCalledTimes(1);
  });

  it("renders additional custom menu items from the tools menu", async () => {
    const handleCustom = vi.fn();

    const { container } = renderWithProvider(
      <CopilotChatInput
        toolsMenu={[{ label: "Custom action", action: handleCustom }]}
        onSubmitMessage={mockOnSubmitMessage}
      />,
    );

    mockLayoutMetrics(container);

    const addButton = getAddMenuButton(container);
    expect(addButton).not.toBeNull();
    const user = userEvent.setup();
    await user.click(addButton!);

    await waitFor(() => {
      expect(addButton?.getAttribute("data-state")).toBe("open");
    });

    const menuItem = await screen.findByRole("menuitem", {
      name: "Custom action",
    });
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
        />,
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
        />,
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
        />,
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
        />,
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
        />,
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
        />,
      );

      const sendButton = getSendButton(container);
      expect(sendButton).not.toBeNull();
      fireEvent.click(sendButton!);

      expect(mockOnSubmitMessage).not.toHaveBeenCalled();
    });

    it("disables send button when onSubmitMessage is not provided", () => {
      const mockOnChange = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput value="some text" onChange={mockOnChange} />,
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
        />,
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
        />,
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
        />,
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
        </CopilotChatConfigurationProvider>,
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
        />,
      );

      const input = screen.getByRole("textbox");
      const sendButton = getSendButton(container);

      fireEvent.click(sendButton!);

      // In controlled mode, the component should not clear the input
      // It's up to the parent to manage the value
      expect((input as HTMLTextAreaElement).value).toBe("test message");
      expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
    });

    it("calls onChange with empty string after submission in controlled mode", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      const { container } = renderWithProvider(
        <CopilotChatInput
          value="test message"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />,
      );

      const sendButton = getSendButton(container);
      fireEvent.click(sendButton!);

      expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
      expect(mockOnChange).toHaveBeenCalledWith("");
    });

    it("calls onChange with empty string after Enter submission in controlled mode", () => {
      const mockOnChange = vi.fn();
      const mockOnSubmitMessage = vi.fn();

      renderWithProvider(
        <CopilotChatInput
          value="hello world"
          onChange={mockOnChange}
          onSubmitMessage={mockOnSubmitMessage}
        />,
      );

      const input = screen.getByRole("textbox");
      fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello world");
      expect(mockOnChange).toHaveBeenCalledWith("");
    });
  });

  describe("Container dimension cache", () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;

    class MockResizeObserver {
      static instances: MockResizeObserver[] = [];
      callback: (entries: Array<{ target: Element }>) => void;
      observedTargets = new Set<Element>();

      constructor(cb: (entries: Array<{ target: Element }>) => void) {
        this.callback = cb;
        MockResizeObserver.instances.push(this);
      }

      observe = vi.fn((target: Element) => {
        this.observedTargets.add(target);
      });

      unobserve = vi.fn((target: Element) => {
        this.observedTargets.delete(target);
      });

      disconnect = vi.fn(() => {
        this.observedTargets.clear();
      });
    }

    const DEFAULT_LAYOUT_OPTIONS = {
      gridWidth: 640,
      addWidth: 48,
      actionsWidth: 96,
      gridPadding: 16,
      columnGap: 8,
      textareaPadding: 20,
    } as const;

    /** Trigger all observers with all their observed targets. */
    const triggerAllResizeObservers = () => {
      for (const instance of MockResizeObserver.instances) {
        const entries = [...instance.observedTargets].map((target) => ({
          target,
        }));
        if (entries.length > 0) {
          instance.callback(entries);
        }
      }
    };

    /** Trigger observers that watch the given targets, with only those targets as entries. */
    const triggerResizeForTargets = (...targets: Element[]) => {
      for (const instance of MockResizeObserver.instances) {
        const matching = targets.filter((t) => instance.observedTargets.has(t));
        if (matching.length > 0) {
          instance.callback(matching.map((t) => ({ target: t })));
        }
      }
    };

    beforeEach(() => {
      MockResizeObserver.instances = [];
      // Double cast required: MockResizeObserver's callback signature uses a
      // simplified `{ target: Element }` entry instead of the full
      // ResizeObserverEntry (which includes contentRect, borderBoxSize, etc.)
      // that the real ResizeObserverCallback demands.
      globalThis.ResizeObserver =
        MockResizeObserver as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      globalThis.ResizeObserver = OriginalResizeObserver;
    });

    /**
     * Extends mockLayoutMetrics with getComputedStyle mocks so that
     * updateContainerCache can compute real compactWidth and font values,
     * exercising the canvas-based text measurement path.
     */
    const mockLayoutMetricsWithComputedStyle = (
      container: HTMLElement,
      options?: {
        gridWidth?: number;
        addWidth?: number;
        actionsWidth?: number;
        gridPadding?: number;
        columnGap?: number;
        textareaPadding?: number;
        font?: string;
      },
    ) => {
      mockLayoutMetrics(container, {
        gridWidth: options?.gridWidth,
        addWidth: options?.addWidth,
        actionsWidth: options?.actionsWidth,
      });

      const {
        gridPadding = 16,
        columnGap = 8,
        textareaPadding = 20,
        font = "16px sans-serif",
      } = options ?? {};

      const grid = container.querySelector(
        "div.cpk\\:grid",
      ) as HTMLElement | null;
      const textarea = container.querySelector(
        "textarea",
      ) as HTMLElement | null;

      const originalGetComputedStyle = window.getComputedStyle;
      // Cast needed: spreading a CSSStyleDeclaration loses the indexed-property
      // accessors and prototype methods, so the result doesn't satisfy the full
      // CSSStyleDeclaration interface. Only the properties the SUT reads matter.
      vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
        if (el === grid) {
          return {
            ...originalGetComputedStyle(el),
            paddingLeft: `${gridPadding}px`,
            paddingRight: `${gridPadding}px`,
            columnGap: `${columnGap}px`,
          } as CSSStyleDeclaration;
        }
        if (el === textarea) {
          return {
            ...originalGetComputedStyle(el),
            paddingLeft: `${textareaPadding}px`,
            paddingRight: `${textareaPadding}px`,
            paddingTop: "12px",
            paddingBottom: "12px",
            font,
            fontStyle: "normal",
            fontVariant: "normal",
            fontWeight: "400",
            fontSize: "16px",
            lineHeight: "24px",
            fontFamily: "sans-serif",
          } as CSSStyleDeclaration;
        }
        return originalGetComputedStyle(el);
      });
    };

    /**
     * Mocks canvas measureText to return a deterministic width per character.
     */
    const mockCanvasMeasureText = (charWidth: number) => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
        // Double cast required: getContext has 6+ overloaded signatures
        // (one per context type) and vitest's mockImplementation cannot
        // unify them into a single callable type.
        function (
          this: HTMLCanvasElement,
          contextId: string,
          ...args: unknown[]
        ) {
          if (contextId === "2d") {
            const ctx = originalGetContext.call(
              this,
              "2d",
              ...(args as [unknown]),
            ) as CanvasRenderingContext2D | null;
            if (ctx) {
              // Cast needed: TextMetrics has many readonly properties
              // (actualBoundingBoxAscent, etc.) that are irrelevant to the
              // SUT — only `width` is read.
              ctx.measureText = (text: string) =>
                ({ width: text.length * charWidth }) as TextMetrics;
            }
            return ctx;
          }
          return originalGetContext.call(
            this,
            contextId,
            ...(args as [unknown]),
          );
        } as unknown as typeof HTMLCanvasElement.prototype.getContext,
      );
    };

    /**
     * Sets up all DOM mocks and invalidates the stale cache from the initial
     * render by triggering the ResizeObserver callback.
     */
    const setupMocksAndInvalidateCache = (
      container: HTMLElement,
      options?: Parameters<typeof mockLayoutMetricsWithComputedStyle>[1],
      charWidth = 10,
    ) => {
      mockLayoutMetricsWithComputedStyle(container, options);
      mockCanvasMeasureText(charWidth);
      // Invalidate the stale cache populated during the initial render
      // so the next evaluateLayout call re-measures with our mocked values.
      triggerAllResizeObservers();
    };

    /**
     * Render CopilotChatInput, set up layout mocks, type text, and wait for
     * the layout to settle. Returns the resulting data-layout attribute value.
     */
    const renderTypeAndExpectLayout = async (
      text: string,
      options?: Parameters<typeof mockLayoutMetricsWithComputedStyle>[1],
      charWidth = 10,
    ) => {
      const { container } = renderWithProvider(
        <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
      );
      setupMocksAndInvalidateCache(container, options, charWidth);

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: text } });

      const grid = await waitFor(() => {
        const g = getLayoutGrid(textarea);
        expect(g).not.toBeNull();
        return g;
      });
      return {
        container,
        textarea,
        grid,
        layout: grid.getAttribute("data-layout"),
      };
    };

    it("expands layout via canvas text measurement when a single long line exceeds compact width", async () => {
      // gridWidth=640, gridPadding=16 each side, columnGap=8, addWidth=48, actionsWidth=96
      // compactWidth = (640 - 32) - 48 - 96 - 16 = 448
      // compactInnerWidth = 448 - 20 - 20 = 408
      // With charWidth=10, text of length 50 = width 500, which > 408 → expand
      const { layout } = await renderTypeAndExpectLayout(
        "a".repeat(50),
        DEFAULT_LAYOUT_OPTIONS,
      );
      expect(layout).toBe("expanded");
    });

    it("stays compact when single-line text fits within the cached compact width", async () => {
      // Width = 10 * 10 = 100, well within compactInnerWidth of 408
      const { layout } = await renderTypeAndExpectLayout(
        "a".repeat(10),
        DEFAULT_LAYOUT_OPTIONS,
      );
      expect(layout).toBe("compact");
    });

    it("re-evaluates layout correctly after container resize invalidates the cache", async () => {
      // Phase 1: wide container — 30 chars fit in compact
      const { container, textarea } = await renderTypeAndExpectLayout(
        "a".repeat(30),
        DEFAULT_LAYOUT_OPTIONS,
      );
      expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
        "compact",
      );

      // Phase 2: simulate a container resize to a much narrower width.
      // compactWidth = (300 - 32) - 48 - 96 - 16 = 108
      // compactInnerWidth = 108 - 20 - 20 = 68
      // Text width = 30 * 10 = 300 > 68 → should expand
      vi.restoreAllMocks();
      mockLayoutMetricsWithComputedStyle(container, {
        ...DEFAULT_LAYOUT_OPTIONS,
        gridWidth: 300,
      });
      mockCanvasMeasureText(10);

      // Trigger resize to invalidate the cache with the new narrow dimensions
      triggerAllResizeObservers();

      // Trigger re-evaluation
      fireEvent.change(textarea, {
        target: { value: "a".repeat(30) + " " },
      });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "expanded",
        );
      });
    });

    it("stays compact when textarea font cannot be resolved (empty font fallback)", async () => {
      const { container } = renderWithProvider(
        <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
      );

      mockLayoutMetrics(container, {
        gridWidth: DEFAULT_LAYOUT_OPTIONS.gridWidth,
        addWidth: DEFAULT_LAYOUT_OPTIONS.addWidth,
        actionsWidth: DEFAULT_LAYOUT_OPTIONS.actionsWidth,
      });

      const originalGetComputedStyle = window.getComputedStyle;
      // Cast needed: see comment in mockLayoutMetricsWithComputedStyle above.
      vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
        return {
          ...originalGetComputedStyle(el),
          font: "",
          fontStyle: "",
          fontVariant: "",
          fontWeight: "",
          fontSize: "",
          lineHeight: "",
          fontFamily: "",
          paddingLeft: "16px",
          paddingRight: "16px",
          columnGap: "8px",
        } as CSSStyleDeclaration;
      });

      // Invalidate cache so it tries to rebuild with the empty font mock
      triggerAllResizeObservers();

      const textarea = screen.getByRole("textbox");

      // Single-line text (under 50-char mock wrap threshold) that would exceed
      // compact width via canvas measurement, but font is empty → skipped → compact
      fireEvent.change(textarea, {
        target: { value: "a".repeat(45) },
      });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });
    });

    it("stays compact when canvas.getContext returns null (no text-width measurement)", async () => {
      const { container } = renderWithProvider(
        <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
      );

      setupMocksAndInvalidateCache(container, DEFAULT_LAYOUT_OPTIONS);

      // Override getContext to return null for "2d"
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

      // Invalidate cache again so the next evaluateLayout uses the null context
      triggerAllResizeObservers();

      const textarea = screen.getByRole("textbox");

      // Single-line text (under 50-char mock wrap threshold) that would exceed
      // compact width via canvas, but getContext is null → stays compact
      fireEvent.change(textarea, {
        target: { value: "a".repeat(45) },
      });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });
    });

    /**
     * Render, set up all mocks, populate the cache with a short keystroke,
     * and wait for compact layout. Returns container, textarea, and grid.
     */
    const renderAndWarmCache = async () => {
      const { container } = renderWithProvider(
        <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
      );
      setupMocksAndInvalidateCache(container, DEFAULT_LAYOUT_OPTIONS);

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "a" } });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });

      return {
        container,
        textarea,
        grid: container.querySelector("div.cpk\\:grid") as HTMLElement,
      };
    };

    /**
     * Install a counting spy on an element's getBoundingClientRect,
     * delegating to the original implementation. Returns the spy.
     */
    const installBoundingRectSpy = (element: HTMLElement) => {
      const spy = vi.fn(element.getBoundingClientRect.bind(element));
      Object.defineProperty(element, "getBoundingClientRect", {
        value: spy,
        configurable: true,
      });
      return spy;
    };

    it("does not re-read container dimensions on keystroke when cache is warm", async () => {
      const { textarea, grid } = await renderAndWarmCache();

      const addRectSpy = installBoundingRectSpy(
        grid.children[0] as HTMLElement,
      );
      const actionsRectSpy = installBoundingRectSpy(
        grid.children[2] as HTMLElement,
      );

      // Type more — should NOT call getBoundingClientRect since cache is warm
      fireEvent.change(textarea, { target: { value: "ab" } });
      fireEvent.change(textarea, { target: { value: "abc" } });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });

      expect(addRectSpy).not.toHaveBeenCalled();
      expect(actionsRectSpy).not.toHaveBeenCalled();
    });

    it("does not invalidate cache when only the textarea resizes", async () => {
      const { textarea, grid } = await renderAndWarmCache();

      const addRectSpy = installBoundingRectSpy(
        grid.children[0] as HTMLElement,
      );

      // Trigger textarea-only resize — should NOT invalidate cache
      triggerResizeForTargets(textarea);
      fireEvent.change(textarea, { target: { value: "ab" } });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });

      expect(addRectSpy).not.toHaveBeenCalled();
    });

    it("invalidates cache when container targets resize", async () => {
      const { textarea, grid } = await renderAndWarmCache();

      const addRectSpy = installBoundingRectSpy(
        grid.children[0] as HTMLElement,
      );

      // Trigger container resize — SHOULD invalidate cache
      triggerResizeForTargets(grid);
      fireEvent.change(textarea, { target: { value: "ab" } });

      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });

      // Cache was invalidated, so updateContainerCache called getBoundingClientRect
      expect(addRectSpy).toHaveBeenCalled();
    });

    it("keeps cache warm during layout toggle (ignoreResizeRef path)", async () => {
      const { textarea, grid } = await renderAndWarmCache();

      // Trigger expansion — ignoreResizeRef set to true by updateLayout
      fireEvent.change(textarea, { target: { value: "line1\nline2" } });
      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "expanded",
        );
      });

      // Simulate observer firing from the layout toggle.
      // Self-inflicted resize: ignoreResizeRef is consumed, cache stays warm.
      triggerAllResizeObservers();

      // Go back to short text — cache should still be warm from before the toggle.
      const addRectSpy = installBoundingRectSpy(
        grid.children[0] as HTMLElement,
      );

      fireEvent.change(textarea, { target: { value: "short" } });
      await waitFor(() => {
        expect(getLayoutGrid(textarea).getAttribute("data-layout")).toBe(
          "compact",
        );
      });

      // Cache was NOT invalidated — no getBoundingClientRect needed
      expect(addRectSpy).not.toHaveBeenCalled();
    });
  });

  describe("Scroll behavior", () => {
    it("does not call scrollIntoView when the textarea receives focus", async () => {
      const scrollIntoViewMock = vi.fn();
      HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

      renderWithProvider(
        <CopilotChatInput autoFocus onSubmitMessage={mockOnSubmitMessage} />,
      );

      const textarea = screen.getByRole("textbox");

      // Trigger focus explicitly (autoFocus also triggers it, but let's be explicit)
      fireEvent.focus(textarea);

      // Wait long enough for the 300ms setTimeout inside the focus handler
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      // Clean up
      delete (HTMLElement.prototype as any).scrollIntoView;
    });

    it("does not auto-focus the textarea by default", () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

      renderWithProvider(
        <CopilotChatInput onSubmitMessage={mockOnSubmitMessage} />,
      );

      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("auto-focuses with preventScroll when autoFocus is true", () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

      renderWithProvider(
        <CopilotChatInput autoFocus onSubmitMessage={mockOnSubmitMessage} />,
      );

      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      focusSpy.mockRestore();
    });
  });
});
