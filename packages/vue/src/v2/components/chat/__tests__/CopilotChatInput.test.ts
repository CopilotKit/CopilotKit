import { defineComponent, h, ref } from "vue";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatInput from "../CopilotChatInput.vue";

const TEST_THREAD_ID = "test-thread";
const mockOnSubmitMessage = vi.fn();

const getSendButton = () =>
  screen.getByTestId("copilot-chat-input-send") as HTMLButtonElement;

const getAddMenuButton = () =>
  screen.getByTestId("copilot-chat-input-add") as HTMLButtonElement;

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

Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
  configurable: true,
  get: function (this: HTMLTextAreaElement) {
    const text = this.value || "";
    const explicitLines = text.split("\n").length;
    let wrappedLines = 0;
    text.split("\n").forEach((line) => {
      const lineWraps = Math.ceil(line.length / 50);
      wrappedLines += Math.max(1, lineWraps);
    });
    const totalLines = Math.max(explicitLines, wrappedLines);
    return totalLines * 24;
  },
});

function renderWithProvider(args?: {
  props?: Record<string, unknown>;
  listeners?: Record<string, (...value: unknown[]) => unknown>;
  template?: string;
}) {
  if (args?.template) {
    const Host = defineComponent({
      components: {
        CopilotChatConfigurationProvider,
        CopilotChatInput,
      },
      setup() {
        return {
          TEST_THREAD_ID,
          inputProps: args.props ?? {},
          listeners: args.listeners ?? {},
        };
      },
      template: args.template,
    });

    return render(Host);
  }

  const Host = defineComponent({
    setup() {
      return {
        inputProps: args?.props ?? {},
        listeners: args?.listeners ?? {},
      };
    },
    render() {
      return h(
        CopilotChatConfigurationProvider,
        { threadId: TEST_THREAD_ID },
        {
          default: () =>
            h(CopilotChatInput, { ...this.inputProps, ...this.listeners }),
        },
      );
    },
  });

  return render(Host);
}

beforeEach(() => {
  mockOnSubmitMessage.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        measureText: (text: string) => ({ width: text.length * 8 }),
        font: "",
      }) as unknown as CanvasRenderingContext2D,
  );
});

describe("CopilotChatInput", () => {
  it("renders with default components and styling", () => {
    const onUpdateModelValue = vi.fn();
    renderWithProvider({
      props: { modelValue: "" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });

    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = getSendButton();

    expect(input).toBeDefined();
    expect(sendButton).not.toBeNull();
    expect(sendButton.disabled).toBe(true);
  });

  it("calls onSubmitMessage with trimmed text when Enter is pressed", async () => {
    const onUpdateModelValue = vi.fn();
    renderWithProvider({
      props: { modelValue: "  hello world  " },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });

    const input = screen.getByPlaceholderText("Type a message...");
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello world");
  });

  it("calls onSubmitMessage when button is clicked", async () => {
    const onUpdateModelValue = vi.fn();
    renderWithProvider({
      props: { modelValue: "test message" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });

    const sendButton = getSendButton();
    expect(sendButton).not.toBeNull();
    await fireEvent.click(sendButton);

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("test message");
  });

  it("manages text state internally when uncontrolled", async () => {
    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });

    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = getSendButton();

    await fireEvent.input(input, { target: { value: "hello" } });
    await fireEvent.click(sendButton);

    expect(mockOnSubmitMessage).toHaveBeenCalledWith("hello");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send when Enter is pressed with Shift key", async () => {
    const onUpdateModelValue = vi.fn();
    renderWithProvider({
      props: { modelValue: "test" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });

    const input = screen.getByPlaceholderText("Type a message...");
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(mockOnSubmitMessage).not.toHaveBeenCalled();
  });

  it("does not send empty or whitespace-only messages", async () => {
    const onUpdateModelValue = vi.fn();
    const first = renderWithProvider({
      props: { modelValue: "" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });

    await fireEvent.click(getSendButton());
    expect(mockOnSubmitMessage).not.toHaveBeenCalled();
    first.unmount();

    renderWithProvider({
      props: { modelValue: "   " },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });
    await fireEvent.click(getSendButton());
    expect(mockOnSubmitMessage).not.toHaveBeenCalled();
  });

  it("keeps input value when no submit handler is provided", async () => {
    renderWithProvider();

    const input = screen.getByPlaceholderText("Type a message...");
    await fireEvent.input(input, { target: { value: "draft" } });
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect((input as HTMLTextAreaElement).value).toBe("draft");
  });

  it("enables button based on value prop", async () => {
    const onUpdateModelValue = vi.fn();
    const first = renderWithProvider({
      props: { modelValue: "" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });
    expect(getSendButton().disabled).toBe(true);
    first.unmount();

    const second = renderWithProvider({
      props: { modelValue: "hello" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });
    expect(getSendButton().disabled).toBe(false);
    second.unmount();

    renderWithProvider({
      props: { modelValue: "" },
      listeners: {
        "onUpdate:modelValue": onUpdateModelValue,
        onSubmitMessage: mockOnSubmitMessage,
      },
    });
    expect(getSendButton().disabled).toBe(true);
  });

  it("accepts custom slot classes", () => {
    const Host = defineComponent({
      components: { CopilotChatConfigurationProvider, CopilotChatInput },
      setup() {
        return { TEST_THREAD_ID };
      },
      template: `
        <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
          <CopilotChatInput
            class="custom-container"
            @submit-message="() => {}"
          >
            <template #text-area="{ value, onInput, onKeydown }">
              <textarea
                data-testid="custom-text-area"
                class="custom-textarea"
                :value="value"
                @input="onInput"
                @keydown="onKeydown"
              />
            </template>
            <template #send-button="{ onClick, disabled }">
              <button
                data-testid="custom-send-button"
                class="custom-button"
                :disabled="disabled"
                @click="onClick"
              >
                Send
              </button>
            </template>
          </CopilotChatInput>
        </CopilotChatConfigurationProvider>
      `,
    });

    const { container } = render(Host);
    expect(container.querySelector(".custom-container")).toBeDefined();
    expect(container.querySelector(".custom-textarea")).toBeDefined();
    expect(container.querySelector(".custom-button")).toBeDefined();
  });

  it("accepts custom components via slots", () => {
    const Host = defineComponent({
      components: { CopilotChatConfigurationProvider, CopilotChatInput },
      setup() {
        return { TEST_THREAD_ID };
      },
      template: `
        <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
          <CopilotChatInput @submit-message="() => {}">
            <template #send-button="{ onClick, disabled }">
              <button data-testid="custom-button" :disabled="disabled" @click="onClick">
                Send Now
              </button>
            </template>
          </CopilotChatInput>
        </CopilotChatConfigurationProvider>
      `,
    });

    render(Host);
    const customButton = screen.getByTestId("custom-button");
    expect(customButton).toBeDefined();
    expect(customButton.textContent?.includes("Send Now")).toBe(true);
  });

  it("supports custom layout via children render prop", () => {
    const Host = defineComponent({
      components: { CopilotChatConfigurationProvider, CopilotChatInput },
      setup() {
        return { TEST_THREAD_ID };
      },
      template: `
        <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
          <CopilotChatInput @submit-message="() => {}">
            <template #layout="{ onSendClick }">
              <div data-testid="custom-layout">
                Custom Layout:
                <button data-testid="layout-send" @click="onSendClick">Send</button>
                <textarea data-testid="layout-textarea" />
              </div>
            </template>
          </CopilotChatInput>
        </CopilotChatConfigurationProvider>
      `,
    });

    render(Host);
    const customLayout = screen.getByTestId("custom-layout");
    expect(customLayout).toBeDefined();
    expect(customLayout.textContent?.includes("Custom Layout:")).toBe(true);
  });

  it("updates its internal layout data attribute when content expands", async () => {
    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });

    const textarea = screen.getByRole("textbox");
    const grid = textarea.closest("[data-layout]") as HTMLElement | null;
    expect(grid?.getAttribute("data-layout")).toBe("compact");

    await fireEvent.input(textarea, {
      target: { value: "line one\nline two" },
    });

    await waitFor(() => {
      expect(grid?.getAttribute("data-layout")).toBe("expanded");
    });
  });

  it("executes slash commands via keyboard selection", async () => {
    const handleFirst = vi.fn();
    const handleSecond = vi.fn();

    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
      props: {
        toolsMenu: [
          { label: "Say hi", action: handleFirst },
          { label: "Open docs", action: handleSecond },
        ],
      },
    });

    const textarea = screen.getByRole("textbox");
    await fireEvent.input(textarea, { target: { value: "/" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    expect(menu).not.toBeNull();
    expect(screen.queryByText("Say hi")).not.toBeNull();
    expect(screen.queryByText("Open docs")).not.toBeNull();

    await fireEvent.keyDown(textarea, {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
    });
    await fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });

    expect(handleSecond).toHaveBeenCalledTimes(1);
    expect(handleFirst).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByTestId("copilot-slash-menu")).toBeNull();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("prioritizes prefix matches when filtering slash commands", async () => {
    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
      props: {
        toolsMenu: [
          { label: "Reopen previous chat", action: vi.fn() },
          { label: "Open CopilotKit", action: vi.fn() },
          { label: "Help me operate", action: vi.fn() },
        ],
      },
    });

    const textarea = screen.getByRole("textbox");
    await fireEvent.input(textarea, { target: { value: "/op" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    const options = within(menu).getAllByRole("option");
    expect(options[0]?.textContent?.includes("Open CopilotKit")).toBe(true);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    await fireEvent.keyDown(textarea, {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
    });
    await waitFor(() => {
      const updated = within(menu).getAllByRole("option");
      expect(updated[1]?.getAttribute("aria-selected")).toBe("true");
    });

    await fireEvent.input(textarea, { target: { value: "/ope" } });
    await waitFor(() => {
      const updated = within(menu).getAllByRole("option");
      expect(updated[0]?.getAttribute("aria-selected")).toBe("true");
      expect(updated[0]?.textContent?.startsWith("Open CopilotKit")).toBe(true);
    });
  });

  it("limits slash menu height when commands exceed five items", async () => {
    const tools = Array.from({ length: 6 }, (_, index) => ({
      label: `Command ${index + 1}`,
      action: vi.fn(),
    }));

    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
      props: { toolsMenu: tools },
    });

    const textarea = screen.getByRole("textbox");
    await fireEvent.input(textarea, { target: { value: "/" } });

    const menu = await screen.findByTestId("copilot-slash-menu");
    await waitFor(() => {
      expect((menu as HTMLElement).style.maxHeight).toBe("200px");
    });
    expect(within(menu).getAllByRole("option").length).toBe(6);
  });

  it("allows slash command actions to populate the input", async () => {
    const greeting = "Hello Copilot! Could you help me with something?";
    const label = "Say hi to CopilotKit";

    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
      props: {
        toolsMenu: [
          {
            label,
            action: () => {
              const textareaElement =
                document.querySelector<HTMLTextAreaElement>("textarea");
              if (!textareaElement) return;
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
        ],
      },
    });

    const textarea = screen.getByRole("textbox");
    await fireEvent.input(textarea, { target: { value: "/" } });

    const option = await screen.findByRole("option", { name: label });
    await fireEvent.mouseDown(option);

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(greeting);
    });
  });

  it("shows cancel and finish buttons in transcribe mode", () => {
    renderWithProvider({
      props: {
        mode: "transcribe",
        toolsMenu: [{ label: "Test Tool", action: () => {} }],
      },
      listeners: {
        onSubmitMessage: mockOnSubmitMessage,
        onStartTranscribe: () => {},
        onCancelTranscribe: () => {},
        onFinishTranscribe: () => {},
        onAddFile: () => {},
      },
    });

    expect(
      screen.getByTestId("copilot-chat-input-cancel-transcribe"),
    ).toBeDefined();
    expect(
      screen.getByTestId("copilot-chat-input-finish-transcribe"),
    ).toBeDefined();
    expect(
      screen.queryByTestId("copilot-chat-input-start-transcribe"),
    ).toBeNull();
    expect(screen.queryByTestId("copilot-chat-input-send")).toBeNull();
  });

  it("disables add menu button in transcribe mode", () => {
    renderWithProvider({
      props: {
        mode: "transcribe",
        toolsMenu: [{ label: "Test Tool", action: () => {} }],
      },
      listeners: {
        onSubmitMessage: mockOnSubmitMessage,
        onStartTranscribe: () => {},
        onCancelTranscribe: () => {},
        onFinishTranscribe: () => {},
        onAddFile: () => {},
      },
    });

    expect(getAddMenuButton().disabled).toBe(true);
  });

  it("shows recording indicator instead of textarea in transcribe mode", () => {
    const { container } = renderWithProvider({
      props: { mode: "transcribe" },
      listeners: {
        onSubmitMessage: mockOnSubmitMessage,
        onStartTranscribe: () => {},
        onCancelTranscribe: () => {},
        onFinishTranscribe: () => {},
        onAddFile: () => {},
      },
    });

    expect(container.querySelector("canvas")).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows textarea in input mode", () => {
    const { container } = renderWithProvider({
      props: { mode: "input" },
      listeners: {
        onSubmitMessage: mockOnSubmitMessage,
        onStartTranscribe: () => {},
        onCancelTranscribe: () => {},
        onFinishTranscribe: () => {},
        onAddFile: () => {},
      },
    });

    expect(screen.getByRole("textbox")).toBeDefined();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("positions the textarea next to the add menu button when single line", () => {
    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });

    const textarea = screen.getByRole("textbox");
    const layoutCell = textarea.parentElement as HTMLElement;
    const gridContainer = layoutCell.parentElement as HTMLElement;

    expect(layoutCell.className).toContain("col-start-2");
    expect(layoutCell.className).not.toContain("col-span-3");
    expect(gridContainer.className).toContain("items-center");
  });

  it("toggles textarea padding based on multiline state", async () => {
    const { container } = renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });
    mockLayoutMetrics(container);

    const textarea = screen.getByRole("textbox");
    expect(textarea.className).toContain("pr-5");
    expect(textarea.className).not.toContain("px-5");

    await fireEvent.input(textarea, {
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
    const { container } = renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });
    mockLayoutMetrics(container);

    const textarea = screen.getByRole("textbox");
    const layoutCell = textarea.parentElement as HTMLElement;

    await fireEvent.input(textarea, {
      target: {
        value:
          "this is a very long line that should expand the layout before it wraps so we can see the stacked arrangement",
      },
    });
    await waitFor(() => {
      expect(layoutCell.className).toContain("col-span-3");
    });

    await fireEvent.input(textarea, { target: { value: "short" } });
    await waitFor(() => {
      expect(layoutCell.className).toContain("col-start-2");
      expect(layoutCell.className).not.toContain("col-span-3");
    });
  });

  it("moves the textarea above the add menu button when multiple lines", async () => {
    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });

    const textarea = screen.getByRole("textbox");
    await fireEvent.input(textarea, {
      target: { value: "first line\nsecond line" },
    });

    await waitFor(() => {
      const layoutCell = textarea.parentElement as HTMLElement;
      expect(layoutCell.className).toContain("col-span-3");
      expect(layoutCell.className).not.toContain("col-start-2");
    });
  });

  it("disables the add menu button when no menu items are provided", () => {
    renderWithProvider({
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });

    const addButton = getAddMenuButton();
    expect(addButton).not.toBeNull();
    expect(addButton.disabled).toBe(true);
  });

  it("opens the add menu and runs onAddFile when the default item is clicked", async () => {
    const handleAddFile = vi.fn();
    const { container } = renderWithProvider({
      listeners: {
        onSubmitMessage: mockOnSubmitMessage,
        onAddFile: handleAddFile,
      },
    });
    mockLayoutMetrics(container);

    const addButton = getAddMenuButton();
    expect(addButton.disabled).toBe(false);

    await fireEvent.click(addButton);
    const menuItem = await screen.findByRole("menuitem", {
      name: "Add photos or files",
    });
    await fireEvent.click(menuItem);
    expect(handleAddFile).toHaveBeenCalledTimes(1);
  });

  it("renders additional custom menu items from the tools menu", async () => {
    const handleCustom = vi.fn();
    const { container } = renderWithProvider({
      props: { toolsMenu: [{ label: "Custom action", action: handleCustom }] },
      listeners: { onSubmitMessage: mockOnSubmitMessage },
    });
    mockLayoutMetrics(container);

    const addButton = getAddMenuButton();
    await fireEvent.click(addButton);

    const menuItem = await screen.findByRole("menuitem", {
      name: "Custom action",
    });
    await fireEvent.click(menuItem);
    expect(handleCustom).toHaveBeenCalledTimes(1);
  });

  describe("Controlled component behavior", () => {
    it("displays the provided value prop", () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "test value" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("test value");
    });

    it("calls onChange when user types", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.input(input, { target: { value: "new text" } });
      expect(onUpdateModelValue).toHaveBeenCalledWith("new text");
    });

    it("calls onSubmitMessage when form is submitted", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "hello world" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
      expect(onSubmit).toHaveBeenCalledWith("hello world");
    });

    it("calls onSubmitMessage when send button is clicked", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "test message" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      await fireEvent.click(getSendButton());
      expect(onSubmit).toHaveBeenCalledWith("test message");
    });

    it("trims whitespace when submitting", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "  hello world  " },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
      expect(onSubmit).toHaveBeenCalledWith("hello world");
    });

    it("does not submit empty or whitespace-only messages", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "   " },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      await fireEvent.click(getSendButton());
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("disables send button when onSubmitMessage is not provided", () => {
      renderWithProvider({
        props: { modelValue: "some text" },
        listeners: { "onUpdate:modelValue": vi.fn() },
      });
      expect(getSendButton().disabled).toBe(true);
    });

    it("disables send button when value is empty", () => {
      renderWithProvider({
        props: { modelValue: "" },
        listeners: {
          "onUpdate:modelValue": vi.fn(),
          onSubmitMessage: vi.fn(),
        },
      });
      expect(getSendButton().disabled).toBe(true);
    });

    it("enables send button when value has content and onSubmitMessage is provided", () => {
      renderWithProvider({
        props: { modelValue: "hello" },
        listeners: {
          "onUpdate:modelValue": vi.fn(),
          onSubmitMessage: vi.fn(),
        },
      });
      expect(getSendButton().disabled).toBe(false);
    });

    it("works as a fully controlled component", async () => {
      const Host = defineComponent({
        components: { CopilotChatConfigurationProvider, CopilotChatInput },
        setup() {
          const value = ref("initial");
          return { TEST_THREAD_ID, value };
        },
        template: `
          <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
            <CopilotChatInput
              :model-value="value"
              @update:model-value="(next) => value = next"
              @submit-message="() => {}"
            />
            <button data-testid="set-updated" @click="value = 'updated'">set</button>
          </CopilotChatConfigurationProvider>
        `,
      });

      render(Host);
      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("initial");
      await fireEvent.click(screen.getByTestId("set-updated"));
      expect((input as HTMLTextAreaElement).value).toBe("updated");
    });

    it("does not clear input after submission when controlled", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "test message" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.click(getSendButton());

      expect((input as HTMLTextAreaElement).value).toBe("test message");
      expect(onSubmit).toHaveBeenCalledWith("test message");
    });

    it("emits update:modelValue('') after button-click submit in controlled mode", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "test message" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      await fireEvent.click(getSendButton());

      expect(onSubmit).toHaveBeenCalledWith("test message");
      expect(onUpdateModelValue).toHaveBeenCalledWith("");
    });

    it("emits update:modelValue('') after Enter submit in controlled mode", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "hello world" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(onSubmit).toHaveBeenCalledWith("hello world");
      expect(onUpdateModelValue).toHaveBeenCalledWith("");
    });
  });

  describe("IME composition parity", () => {
    it("does not submit on Enter while composition is active", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "こんに" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.compositionStart(input);
      await fireEvent.keyDown(input, {
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits on Enter after compositionend", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "こんにちは" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.compositionStart(input);
      await fireEvent.compositionEnd(input);
      await fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

      expect(onSubmit).toHaveBeenCalledWith("こんにちは");
    });

    it("does not submit when keydown reports isComposing: true", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "abc" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.keyDown(input, {
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not submit when keydown reports keyCode 229", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "abc" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox");
      await fireEvent.keyDown(input, {
        key: "Enter",
        shiftKey: false,
        keyCode: 229,
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not reset textarea value during active composition", async () => {
      const onUpdateModelValue = vi.fn();
      const onSubmit = vi.fn();
      renderWithProvider({
        props: { modelValue: "" },
        listeners: {
          "onUpdate:modelValue": onUpdateModelValue,
          onSubmitMessage: onSubmit,
        },
      });

      const input = screen.getByRole("textbox") as HTMLTextAreaElement;
      await fireEvent.compositionStart(input);
      input.value = "部分";
      await fireEvent.input(input, { target: { value: "部分" } });

      expect(input.value).toBe("部分");
    });
  });
});
