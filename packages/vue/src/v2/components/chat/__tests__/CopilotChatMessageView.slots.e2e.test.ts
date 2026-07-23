import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { ActivityMessage, AssistantMessage, Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

function mountMessageView(
  messages: Message[],
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
            default: () => h(CopilotChatMessageView, { messages }, slots),
          },
        ),
    },
  });
}

describe("CopilotChatMessageView.slots.e2e", () => {
  it("prefers named activity slot over generic activity slot", () => {
    const messages: Message[] = [
      {
        id: "activity-1",
        role: "activity",
        activityType: "search-progress",
        content: { percent: 40 },
      } as ActivityMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "activity-search-progress": () =>
        h("div", { "data-testid": "named-activity-slot" }, "named"),
      "activity-message": () =>
        h("div", { "data-testid": "fallback-activity-slot" }, "fallback"),
    });

    expect(wrapper.find("[data-testid='named-activity-slot']").exists()).toBe(
      true,
    );
    expect(
      wrapper.find("[data-testid='fallback-activity-slot']").exists(),
    ).toBe(false);
  });

  it("prefers generic activity slot over built-in MCP fallback", () => {
    const messages: Message[] = [
      {
        id: "activity-mcp",
        role: "activity",
        activityType: "mcp-apps",
        content: {
          resourceUri: "ui://server/dashboard",
          serverHash: "abc123",
          result: {},
        },
      } as ActivityMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "activity-message": () =>
        h("div", { "data-testid": "generic-activity-slot" }, "generic"),
    });

    expect(wrapper.find("[data-testid='generic-activity-slot']").exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain(
      "No agent available to fetch resource",
    );
  });

  it("prefers named tool slot over generic tool slot", () => {
    const messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            type: "function",
            function: {
              name: "search_docs",
              arguments: JSON.stringify({ query: "slots" }),
            },
          },
        ],
      } as AssistantMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "tool-call-search_docs": ({ status }: { status: string }) =>
        h("div", { "data-testid": "named-tool-slot" }, status),
      "tool-call": () =>
        h("div", { "data-testid": "generic-tool-slot" }, "generic"),
    });

    expect(wrapper.find("[data-testid='named-tool-slot']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='generic-tool-slot']").exists()).toBe(
      false,
    );
  });

  it("renders generic tool slot when named slot is absent", () => {
    const messages: Message[] = [
      {
        id: "assistant-2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            type: "function",
            function: {
              name: "unknown_tool",
              arguments: JSON.stringify({ query: "fallback" }),
            },
          },
        ],
      } as AssistantMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "tool-call": ({ name }: { name: string }) =>
        h("div", { "data-testid": "generic-tool-slot" }, name),
    });

    expect(wrapper.get("[data-testid='generic-tool-slot']").text()).toBe(
      "unknown_tool",
    );
  });
});
