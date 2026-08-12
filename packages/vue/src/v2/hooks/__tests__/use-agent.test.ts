import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, toRaw } from "vue";
import type { AbstractAgent, Message } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import { useAgent } from "../use-agent";
import { useCopilotKit } from "../../providers/useCopilotKit";
import {
  mountWithProvider,
  renderWithCopilotKit,
} from "../../__tests__/utils/mount";
import { StateCapturingAgent } from "../../__tests__/utils/agents";

describe("useAgent", () => {
  beforeEach(() => {
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  it("returns local agent from agents__unsafe_dev_only", () => {
    const mockAgent = new StateCapturingAgent([], "test-agent");

    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });
        return () =>
          h(
            "span",
            { "data-testid": "agent-id" },
            agent.value?.agentId ?? "none",
          );
      },
    });

    const { wrapper } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: {
        "test-agent": mockAgent as unknown as AbstractAgent,
      },
    });

    expect(wrapper.find("[data-testid=agent-id]").text()).toBe("test-agent");
  });

  it("uses agentId from chat configuration when no agentId prop is provided", () => {
    const mockAgent = new StateCapturingAgent([], "configured-agent");

    const Child = defineComponent({
      setup() {
        const { agent } = useAgent();
        return () =>
          h(
            "span",
            { "data-testid": "agent-id" },
            agent.value?.agentId ?? "none",
          );
      },
    });

    const { wrapper } = renderWithCopilotKit(() => h(Child), {
      agentId: "configured-agent",
      agents: {
        "configured-agent": mockAgent as unknown as AbstractAgent,
      },
    });

    expect(wrapper.find("[data-testid=agent-id]").text()).toBe(
      "configured-agent",
    );
  });

  it("uses explicit agentId over chat configuration", () => {
    const configuredAgent = new StateCapturingAgent([], "configured-agent");
    const explicitAgent = new StateCapturingAgent([], "explicit-agent");

    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "explicit-agent" });
        return () =>
          h(
            "span",
            { "data-testid": "agent-id" },
            agent.value?.agentId ?? "none",
          );
      },
    });

    const { wrapper } = renderWithCopilotKit(() => h(Child), {
      agentId: "configured-agent",
      agents: {
        "configured-agent": configuredAgent as unknown as AbstractAgent,
        "explicit-agent": explicitAgent as unknown as AbstractAgent,
      },
    });

    expect(wrapper.find("[data-testid=agent-id]").text()).toBe(
      "explicit-agent",
    );
  });

  it("passes state set through useAgent into run input", async () => {
    const mockAgent = new StateCapturingAgent(
      [{ newMessages: [] }],
      "test-agent",
    );

    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });
        const { copilotkit } = useCopilotKit();

        const runWithState = async () => {
          toRaw(agent.value).setState({ testKey: "testValue", counter: 42 });
          await copilotkit.value.runAgent({
            agent: toRaw(agent.value) as AbstractAgent,
          });
        };

        return () =>
          h(
            "button",
            { "data-testid": "run-state", onClick: runWithState },
            "run",
          );
      },
    });

    const { wrapper } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: {
        "test-agent": mockAgent as unknown as AbstractAgent,
      },
    });

    await wrapper.find("[data-testid=run-state]").trigger("click");
    await nextTick();

    expect(mockAgent.state).toEqual({
      testKey: "testValue",
      counter: 42,
    });
  });

  it("passes messages added through useAgent into run input", async () => {
    const mockAgent = new StateCapturingAgent(
      [{ newMessages: [] }],
      "test-agent",
    );

    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });
        const { copilotkit } = useCopilotKit();

        const runWithMessage = async () => {
          const userMessage: Message = {
            id: randomUUID(),
            role: "user",
            content: "Hello from useAgent",
          } as Message;
          toRaw(agent.value).addMessage(userMessage);
          await copilotkit.value.runAgent({
            agent: toRaw(agent.value) as AbstractAgent,
          });
        };

        return () =>
          h(
            "button",
            { "data-testid": "run-message", onClick: runWithMessage },
            "run",
          );
      },
    });

    const { wrapper } = mountWithProvider(() => h(Child), {
      agents__unsafe_dev_only: {
        "test-agent": mockAgent as unknown as AbstractAgent,
      },
    });

    await wrapper.find("[data-testid=run-message]").trigger("click");
    await nextTick();

    const lastMessage = mockAgent.messages.find((m) => m.role === "user");
    expect(lastMessage?.content).toBe("Hello from useAgent");
  });
});
