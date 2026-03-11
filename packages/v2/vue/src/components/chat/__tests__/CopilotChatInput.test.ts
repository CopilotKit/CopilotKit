import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { ToolsMenuItem } from "../types";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatInput from "../CopilotChatInput.vue";

function mountWithProvider(
  props: Record<string, unknown> = {},
  listeners: Record<string, (...args: unknown[]) => unknown> = {},
) {
  return mount(CopilotChatConfigurationProvider, {
    props: {
      threadId: "thread-1",
      agentId: "default",
      labels: {
        chatInputPlaceholder: "Ask anything",
        chatDisclaimerText: "Double-check important answers.",
      },
    },
    slots: {
      default: () => h(CopilotChatInput, { ...props, ...listeners }),
    },
  });
}

describe("CopilotChatInput", () => {
  it("resolves placeholder from provider labels", () => {
    const wrapper = mountWithProvider();
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");
    expect(textarea.attributes("placeholder")).toBe("Ask anything");
  });

  it("submits trimmed value and clears in controlled mode", async () => {
    const onSubmitMessage = vi.fn();
    const onUpdateModelValue = vi.fn();
    const wrapper = mountWithProvider(
      { modelValue: "  hello world  " },
      {
        onSubmitMessage,
        "onUpdate:modelValue": onUpdateModelValue,
      },
    );

    await wrapper.get("[data-testid=copilot-chat-input-textarea]").trigger("keydown", { key: "Enter" });

    expect(onSubmitMessage).toHaveBeenCalledWith("hello world");
    expect(onUpdateModelValue).toHaveBeenCalledWith("");
  });

  it("does not submit on Shift+Enter", async () => {
    const onSubmitMessage = vi.fn();
    const wrapper = mountWithProvider(
      { modelValue: "hello" },
      { onSubmitMessage },
    );

    await wrapper
      .get("[data-testid=copilot-chat-input-textarea]")
      .trigger("keydown", { key: "Enter", shiftKey: true });

    expect(onSubmitMessage).not.toHaveBeenCalled();
  });

  it("does not submit whitespace-only input", async () => {
    const onSubmitMessage = vi.fn();
    const onUpdateModelValue = vi.fn();
    const wrapper = mountWithProvider(
      { modelValue: "   " },
      {
        onSubmitMessage,
        "onUpdate:modelValue": onUpdateModelValue,
      },
    );

    await wrapper.get("[data-testid=copilot-chat-input-send]").trigger("click");

    expect(onSubmitMessage).not.toHaveBeenCalled();
    expect(onUpdateModelValue).not.toHaveBeenCalled();
  });

  it("clears local state after submit in uncontrolled mode", async () => {
    const onSubmitMessage = vi.fn();
    const onUpdateModelValue = vi.fn();
    const wrapper = mountWithProvider(
      {},
      {
        onSubmitMessage,
        "onUpdate:modelValue": onUpdateModelValue,
      },
    );
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");

    await textarea.setValue("hello");
    await textarea.trigger("keydown", { key: "Enter" });

    expect(onSubmitMessage).toHaveBeenCalledWith("hello");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("");
    expect(onUpdateModelValue).toHaveBeenCalledWith("");
  });

  it("blocks submit while IME composition is active", async () => {
    const onSubmitMessage = vi.fn();
    const wrapper = mountWithProvider(
      { modelValue: "hello" },
      { onSubmitMessage },
    );
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");

    await textarea.trigger("compositionstart");
    await textarea.trigger("keydown", { key: "Enter", isComposing: true });
    expect(onSubmitMessage).not.toHaveBeenCalled();

    await textarea.trigger("compositionend");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(onSubmitMessage).toHaveBeenCalledWith("hello");
  });

  it("renders disclaimer only for absolute positioning by default", () => {
    const staticWrapper = mountWithProvider();
    expect(staticWrapper.find("[data-testid=copilot-chat-input-disclaimer]").exists()).toBe(false);

    const absoluteWrapper = mountWithProvider({ positioning: "absolute" });
    expect(absoluteWrapper.get("[data-testid=copilot-chat-input-disclaimer]").text()).toBe(
      "Double-check important answers.",
    );
  });

  it("supports explicit disclaimer override", () => {
    const visible = mountWithProvider({ positioning: "static", showDisclaimer: true });
    expect(visible.find("[data-testid=copilot-chat-input-disclaimer]").exists()).toBe(true);

    const hidden = mountWithProvider({ positioning: "absolute", showDisclaimer: false });
    expect(hidden.find("[data-testid=copilot-chat-input-disclaimer]").exists()).toBe(false);
  });

  it("shows start transcribe button only when handler exists", () => {
    const withoutHandler = mountWithProvider();
    expect(
      withoutHandler.find("[data-testid=copilot-chat-input-start-transcribe]").exists(),
    ).toBe(false);

    const withHandler = mountWithProvider({}, { onStartTranscribe: vi.fn() });
    expect(
      withHandler.find("[data-testid=copilot-chat-input-start-transcribe]").exists(),
    ).toBe(true);
  });

  it("runs add-file action through menu item", async () => {
    const onAddFile = vi.fn();
    const wrapper = mountWithProvider({}, { onAddFile });

    const addButton = wrapper.get("[data-testid=copilot-chat-input-add]");
    await addButton.trigger("click");

    const menuItem = wrapper.get("[role='menuitem']");
    await menuItem.trigger("click");
    expect(onAddFile).toHaveBeenCalledTimes(1);
  });

  it("supports tools menu actions and slash commands", async () => {
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const toolsMenu: (ToolsMenuItem | "-")[] = [
      { label: "Say hi", action: firstAction },
      { label: "Open docs", action: secondAction },
    ];

    const wrapper = mountWithProvider({ toolsMenu }, { onSubmitMessage: vi.fn() });
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");

    await textarea.setValue("/");
    expect(wrapper.find("[data-testid=copilot-slash-menu]").exists()).toBe(true);

    await textarea.trigger("keydown", { key: "ArrowDown" });
    await textarea.trigger("keydown", { key: "Enter" });

    expect(secondAction).toHaveBeenCalledTimes(1);
    expect(firstAction).not.toHaveBeenCalled();
    expect((textarea.element as HTMLTextAreaElement).value).toBe("");
  });

  it("prioritizes prefix matches in slash command filtering", async () => {
    const toolsMenu: (ToolsMenuItem | "-")[] = [
      { label: "Reopen previous chat", action: vi.fn() },
      { label: "Open CopilotKit", action: vi.fn() },
      { label: "Help me operate", action: vi.fn() },
    ];

    const wrapper = mountWithProvider({ toolsMenu });
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");
    await textarea.setValue("/op");

    const options = wrapper.findAll("[role='option']");
    expect(options[0]?.text()).toContain("Open CopilotKit");
  });

  it("switches to expanded layout for multiline input", async () => {
    const wrapper = mountWithProvider();
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");
    await textarea.setValue("first line\nsecond line");

    const shell = wrapper.get("[data-testid=copilot-chat-input-shell]");
    expect(shell.attributes("data-layout")).toBe("expanded");
  });

  it("shows transcribe controls and emits finish events", async () => {
    const onCancelTranscribe = vi.fn();
    const onFinishTranscribe = vi.fn();
    const onFinishTranscribeWithAudio = vi.fn();
    const wrapper = mountWithProvider(
      { mode: "transcribe" },
      {
        onCancelTranscribe,
        onFinishTranscribe,
        onFinishTranscribeWithAudio,
      },
    );

    expect(wrapper.find("[data-testid=copilot-chat-input-textarea]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=copilot-chat-input-cancel-transcribe]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=copilot-chat-input-finish-transcribe]").exists()).toBe(true);

    await wrapper.get("[data-testid=copilot-chat-input-cancel-transcribe]").trigger("click");
    expect(onCancelTranscribe).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.get("[data-testid=copilot-chat-input-finish-transcribe]").trigger("click");
    expect(onFinishTranscribe).toHaveBeenCalledTimes(1);
    expect(onFinishTranscribeWithAudio).toHaveBeenCalledTimes(1);
  });

  it("turns send button into stop control while processing", async () => {
    const onStop = vi.fn();
    const wrapper = mountWithProvider(
      { isRunning: true, modelValue: "" },
      { onStop },
    );

    const sendButton = wrapper.get("[data-testid=copilot-chat-input-send]");
    expect(sendButton.attributes("disabled")).toBeUndefined();

    await sendButton.trigger("click");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("supports controlled typing via update:modelValue", async () => {
    const Harness = defineComponent({
      setup() {
        const value = ref("");
        return () =>
          h(CopilotChatConfigurationProvider, { threadId: "thread-1", agentId: "default" }, {
            default: () =>
              h(CopilotChatInput, {
                modelValue: value.value,
                "onUpdate:modelValue": (next: string) => {
                  value.value = next;
                },
              }),
          });
      },
    });

    const wrapper = mount(Harness);
    const textarea = wrapper.get("[data-testid=copilot-chat-input-textarea]");
    await textarea.setValue("draft");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("draft");
  });
});
