import { defineComponent, h } from "vue";
import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatInput from "../CopilotChatInput.vue";
import CopilotChatView from "../CopilotChatView.vue";

const TEST_THREAD_ID = "test-thread";

const PADDING_VAR = "var(--copilotkit-license-banner-offset, 0px)";

function renderInput(props: Record<string, unknown>) {
  const Host = defineComponent({
    render() {
      return h(
        CopilotChatConfigurationProvider,
        { threadId: TEST_THREAD_ID },
        { default: () => h(CopilotChatInput, props) },
      );
    },
  });
  return render(Host);
}

describe("CopilotChatInput bottom-anchored offset", () => {
  it('reserves padding-bottom for the license banner when positioning="absolute"', () => {
    renderInput({ modelValue: "", positioning: "absolute" });
    const container = screen.getByTestId(
      "copilot-chat-input-container",
    ) as HTMLElement;
    expect(container.style.paddingBottom).toBe(PADDING_VAR);
  });

  it('reserves padding-bottom for the license banner when bottomAnchored=true (positioning="static")', () => {
    renderInput({
      modelValue: "",
      positioning: "static",
      bottomAnchored: true,
    });
    const container = screen.getByTestId(
      "copilot-chat-input-container",
    ) as HTMLElement;
    expect(container.style.paddingBottom).toBe(PADDING_VAR);
  });

  it("does NOT reserve padding-bottom for the welcome (static, non-bottomAnchored) input", () => {
    renderInput({ modelValue: "", positioning: "static" });
    const container = screen.getByTestId(
      "copilot-chat-input-container",
    ) as HTMLElement;
    expect(container.style.paddingBottom).toBe("");
  });

  it("CopilotChatView main overlay forwards bottomAnchored=true to its input", () => {
    const Host = defineComponent({
      render() {
        return h(CopilotKitProvider, null, {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: TEST_THREAD_ID },
              {
                default: () =>
                  h(CopilotChatView, {
                    messages: [
                      { id: "m1", role: "user", content: "hi" },
                      { id: "m2", role: "assistant", content: "hello" },
                    ],
                  }),
              },
            ),
        });
      },
    });

    const view = render(Host);
    const container = view.getByTestId(
      "copilot-chat-input-container",
    ) as HTMLElement;
    expect(container.style.paddingBottom).toBe(PADDING_VAR);
  });
});
