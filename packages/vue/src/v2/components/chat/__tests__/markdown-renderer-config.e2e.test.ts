import { describe, it, expect } from "vitest";
import { h, defineComponent, provide } from "vue";
import { render } from "@testing-library/vue";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import { MARKDOWN_RENDERER_KEY } from "../../../providers/markdown-renderer";

const codeMsg: AssistantMessage = { id: "m1", role: "assistant", content: "```\nx\n```" } as any;

/** Wraps the component in the required providers, optionally injecting a markdownRenderer. */
function makeWrapper(rendererValue: unknown) {
  return defineComponent({
    render() {
      return h(CopilotKitProvider, { runtimeUrl: "/api/copilotkit" }, () => [
        h(CopilotChatConfigurationProvider, { threadId: "test-thread" }, () => [
          h(
            defineComponent({
              setup() {
                provide(MARKDOWN_RENDERER_KEY, rendererValue as any);
                return () => h(CopilotChatAssistantMessage, { message: codeMsg, messages: [codeMsg] });
              },
            }),
          ),
        ]),
      ]);
    },
  });
}

describe("Vue markdownRenderer config", () => {
  it("provider config configures the built-in default", () => {
    const { container } = render(
      makeWrapper({
        nodeRenderers: {
          codeBlock: (node: any) => h("pre", { "data-testid": "prov-code" }, node.text),
        },
      }),
    );
    expect(container.querySelector('[data-testid="prov-code"]')).not.toBeNull();
  });

  it("provider component replaces the renderer (escape hatch)", () => {
    const Custom = (props: { content: string }) =>
      h("div", { "data-testid": "custom" }, props.content);
    const { container } = render(makeWrapper(Custom));
    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
  });
});
