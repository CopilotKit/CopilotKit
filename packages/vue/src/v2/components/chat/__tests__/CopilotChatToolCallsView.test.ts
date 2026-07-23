import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { defineToolCallRenderer } from "../../../types";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import CopilotChatToolCallsView from "../CopilotChatToolCallsView.vue";

function baseAssistantMessage(toolName = "search_docs"): AssistantMessage {
  return {
    id: "assistant-tool",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "tc-1",
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify({ query: "vue slots" }),
        },
      },
    ],
  };
}

function mountToolCallsView(
  message: AssistantMessage,
  messages: Message[] = [message],
  slots: Parameters<typeof h>[2] = {},
) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", agentId: "default" },
          {
            default: () =>
              h(
                CopilotChatToolCallsView,
                {
                  message,
                  messages,
                },
                slots,
              ),
          },
        ),
    },
  });
}

describe("CopilotChatToolCallsView", () => {
  it("renders nothing when assistant message has no tool calls", () => {
    const message: AssistantMessage = {
      id: "assistant-empty",
      role: "assistant",
      content: "No tools",
      toolCalls: [],
    };

    const wrapper = mountToolCallsView(message);
    expect(wrapper.text().trim()).toBe("");
  });

  it("prefers named tool slot over fallback slot", () => {
    const message = baseAssistantMessage("search_docs");
    const wrapper = mountToolCallsView(message, [message], {
      "tool-call-search_docs": ({ status }: { status: string }) =>
        h("div", { "data-testid": "named-tool-slot" }, status),
      "tool-call": () =>
        h("div", { "data-testid": "fallback-tool-slot" }, "fallback"),
    });

    expect(wrapper.find("[data-testid='named-tool-slot']").text()).toBe(
      "inProgress",
    );
    expect(wrapper.find("[data-testid='fallback-tool-slot']").exists()).toBe(
      false,
    );
  });

  it("uses fallback tool slot when no named slot matches", () => {
    const message = baseAssistantMessage("unknown_tool");
    const wrapper = mountToolCallsView(message, [message], {
      "tool-call": ({ name }: { name: string }) =>
        h("div", { "data-testid": "fallback-tool-slot" }, name),
    });

    expect(wrapper.find("[data-testid='fallback-tool-slot']").text()).toBe(
      "unknown_tool",
    );
  });

  it("falls back to provider/core renderers when no slots are provided", () => {
    const message = baseAssistantMessage("search_docs");
    const RegisterRenderer = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        copilotkit.value.setRenderToolCalls([
          defineToolCallRenderer({
            name: "search_docs",
            args: undefined,
            render: ({ name, status }) =>
              h(
                "div",
                { "data-testid": "core-render-tool" },
                `${name}:${status}`,
              ),
          }),
        ]);
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h("div", [
                  h(RegisterRenderer),
                  h(CopilotChatToolCallsView, {
                    message,
                    messages: [message],
                  }),
                ]),
            },
          ),
      },
    });

    expect(wrapper.get("[data-testid='core-render-tool']").text()).toBe(
      "search_docs:inProgress",
    );
  });

  it("renders a registered Vue component renderer", () => {
    const message = baseAssistantMessage("search_docs");
    const ToolRenderer = defineComponent({
      props: {
        name: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          required: true,
        },
      },
      template: `<div data-testid="component-render-tool">{{ name }}:{{ status }}</div>`,
    });
    const RegisterRenderer = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        copilotkit.value.setRenderToolCalls([
          defineToolCallRenderer({
            name: "search_docs",
            args: undefined,
            render: ToolRenderer,
          }),
        ]);
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h("div", [
                  h(RegisterRenderer),
                  h(CopilotChatToolCallsView, {
                    message,
                    messages: [message],
                  }),
                ]),
            },
          ),
      },
    });

    expect(wrapper.get("[data-testid='component-render-tool']").text()).toBe(
      "search_docs:inProgress",
    );
  });

  it("prefers slots over registered core renderers", () => {
    const message = baseAssistantMessage("search_docs");
    const RegisterRenderer = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        copilotkit.value.setRenderToolCalls([
          defineToolCallRenderer({
            name: "search_docs",
            args: undefined,
            render: () =>
              h("div", { "data-testid": "core-render-tool" }, "core"),
          }),
        ]);
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h("div", [
                  h(RegisterRenderer),
                  h(
                    CopilotChatToolCallsView,
                    { message, messages: [message] },
                    {
                      "tool-call-search_docs": ({
                        status,
                      }: {
                        status: string;
                      }) =>
                        h("div", { "data-testid": "named-tool-slot" }, status),
                    },
                  ),
                ]),
            },
          ),
      },
    });

    expect(wrapper.get("[data-testid='named-tool-slot']").text()).toBe(
      "inProgress",
    );
    expect(wrapper.find("[data-testid='core-render-tool']").exists()).toBe(
      false,
    );
  });

  it("prefers current-agent renderers over unscoped and wildcard renderers", () => {
    const message = baseAssistantMessage("search_docs");
    const RegisterRenderer = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        copilotkit.value.setRenderToolCalls([
          defineToolCallRenderer({
            name: "*",
            render: () =>
              h("div", { "data-testid": "wildcard-render-tool" }, "wildcard"),
          }),
          defineToolCallRenderer({
            name: "search_docs",
            args: undefined,
            render: () =>
              h("div", { "data-testid": "global-render-tool" }, "global"),
          }),
          defineToolCallRenderer({
            name: "search_docs",
            args: undefined,
            agentId: "default",
            render: () =>
              h("div", { "data-testid": "agent-render-tool" }, "agent"),
          }),
        ]);
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h("div", [
                  h(RegisterRenderer),
                  h(CopilotChatToolCallsView, {
                    message,
                    messages: [message],
                  }),
                ]),
            },
          ),
      },
    });

    expect(wrapper.get("[data-testid='agent-render-tool']").text()).toBe(
      "agent",
    );
    expect(wrapper.find("[data-testid='global-render-tool']").exists()).toBe(
      false,
    );
    expect(wrapper.find("[data-testid='wildcard-render-tool']").exists()).toBe(
      false,
    );
  });

  it("renders complete status and result when tool message exists", () => {
    const message = baseAssistantMessage("search_docs");
    const toolMessage: ToolMessage = {
      id: "tool-result-1",
      role: "tool",
      toolCallId: "tc-1",
      content: "found docs",
    };

    const wrapper = mountToolCallsView(message, [message, toolMessage], {
      "tool-call-search_docs": ({
        status,
        result,
      }: {
        status: string;
        result?: string;
      }) => h("div", { "data-testid": "tool-status" }, `${status}:${result}`),
    });

    expect(wrapper.find("[data-testid='tool-status']").text()).toBe(
      "complete:found docs",
    );
  });

  it("renders executing status when tool call id is executing", () => {
    const message = baseAssistantMessage("search_docs");
    const SetExecuting = defineComponent({
      setup() {
        const { executingToolCallIds } = useCopilotKit();
        executingToolCallIds.value = new Set(["tc-1"]);
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h("div", [
                  h(SetExecuting),
                  h(
                    CopilotChatToolCallsView,
                    { message, messages: [message] },
                    {
                      "tool-call-search_docs": ({
                        status,
                      }: {
                        status: string;
                      }) => h("div", { "data-testid": "tool-status" }, status),
                    },
                  ),
                ]),
            },
          ),
      },
    });

    expect(wrapper.find("[data-testid='tool-status']").text()).toBe(
      "executing",
    );
  });
});
