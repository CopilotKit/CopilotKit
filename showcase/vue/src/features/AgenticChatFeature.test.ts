import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";

import type { VueHostConfiguration } from "../host-configuration";
import AgenticChatFeature from "./AgenticChatFeature.vue";

vi.mock("@copilotkit/vue/v2", () => ({
  CopilotKitProvider: defineComponent({
    props: {
      runtimeUrl: { type: String, required: true },
      publicLicenseKey: { type: String, required: true },
    },
    template:
      '<section data-testid="copilot-provider" :data-runtime-url="runtimeUrl"><slot /></section>',
  }),
  CopilotChatConfigurationProvider: defineComponent({
    props: {
      agentId: { type: String, required: true },
      threadId: { type: String, default: undefined },
    },
    template:
      '<section data-testid="chat-configuration" :data-agent-id="agentId" :data-thread-id="threadId"><slot /></section>',
  }),
  CopilotChat: defineComponent({
    props: {
      agentId: { type: String, required: true },
      threadId: { type: String, default: undefined },
    },
    template:
      '<div data-testid="copilot-chat" :data-agent-id="agentId" :data-thread-id="threadId"></div>',
  }),
}));

const configuration: VueHostConfiguration = {
  cellId: "vue/langgraph-python/agentic-chat",
  integration: "langgraph-python",
  feature: "agentic-chat",
  runtimeUrl: "/api/copilotkit",
  agentId: "agentic_chat",
  threadId: undefined,
  suggestions: [],
  componentKey: "agentic-chat",
};

describe("Vue agentic-chat feature", () => {
  it("constructs the canonical public Vue chat tree from resolved configuration", () => {
    const wrapper = mount(AgenticChatFeature, {
      props: { configuration },
    });
    const provider = wrapper.get('[data-testid="copilot-provider"]');
    const chat = wrapper.get('[data-testid="copilot-chat"]');

    expect(
      wrapper.get('[data-testid="vue-agentic-chat"]').attributes("data-testid"),
    ).toBe("vue-agentic-chat");
    expect(wrapper.get('[data-testid="showcase-cell-id"]').text()).toBe(
      configuration.cellId,
    );
    expect(provider.attributes("data-runtime-url")).toBe("/api/copilotkit");
    expect(
      wrapper
        .get('[data-testid="chat-configuration"]')
        .attributes("data-agent-id"),
    ).toBe("agentic_chat");
    expect(chat.attributes("data-agent-id")).toBe("agentic_chat");
    expect(provider.element.contains(chat.element)).toBe(true);
  });
});
