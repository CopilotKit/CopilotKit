import { describe, it, expect } from "vitest";
import { defineComponent, h, provide } from "vue";
import { render } from "@testing-library/vue";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import { MARKDOWN_RENDERER_KEY } from "../../../providers/markdown-renderer";

const message: AssistantMessage = {
  id: "1",
  role: "assistant",
  content: "# Hi",
};

const Providers = (inner: object) =>
  defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
    },
    render() {
      return h(CopilotKitProvider, { runtimeUrl: "/api/copilotkit" }, () => [
        h(CopilotChatConfigurationProvider, { threadId: "test-thread" }, () => [
          h(inner),
        ]),
      ]);
    },
  });

describe("CopilotChatAssistantMessage markdown (vue)", () => {
  it("renders basic markdown by default", () => {
    const Inner = defineComponent({
      setup: () => () => h(CopilotChatAssistantMessage, { message }),
    });
    const { container } = render(Providers(Inner));
    expect(container.querySelector("h1")?.textContent).toBe("Hi");
  });

  it("uses the provided renderer when set", () => {
    const Custom = defineComponent({
      props: { content: { type: String, default: "" } },
      setup: (p) => () => h("div", { "data-testid": "custom" }, p.content),
    });
    const Inner = defineComponent({
      setup() {
        provide(MARKDOWN_RENDERER_KEY, Custom);
        return () => h(CopilotChatAssistantMessage, { message });
      },
    });
    const { container } = render(Providers(Inner));
    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
  });
});
