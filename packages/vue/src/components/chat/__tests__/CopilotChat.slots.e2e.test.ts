import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { h } from "vue";
import CopilotChat from "../CopilotChat.vue";
import { renderWithCopilotKit } from "../../../__tests__/utils/mount";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";

describe("CopilotChat.slots.e2e", () => {
  it("supports full chat-view override with callback payload", async () => {
    const agent = new StateCapturingAgent([], "default");
    const onSubmitSpy = vi.fn();

    const { wrapper } = renderWithCopilotKit(
      () =>
        h(
          CopilotChat,
          {
            welcomeScreen: false,
            onSubmitMessage: onSubmitSpy,
          },
          {
            "chat-view": ({ messages, isRunning, onSubmitMessage }: any) =>
              h("div", { "data-testid": "custom-chat-view" }, [
                h("span", { "data-testid": "slot-running" }, String(isRunning)),
                h(
                  "span",
                  { "data-testid": "slot-message-count" },
                  String(messages.length),
                ),
                h(
                  "button",
                  {
                    "data-testid": "slot-submit",
                    onClick: () => void onSubmitMessage("From custom slot"),
                  },
                  "submit",
                ),
              ]),
          },
        ),
      { agents: { default: agent } },
    );

    expect(wrapper.find("[data-testid='custom-chat-view']").exists()).toBe(
      true,
    );
    expect(wrapper.get("[data-testid='slot-message-count']").text()).toBe("0");

    await wrapper.get("[data-testid='slot-submit']").trigger("click");
    await flushPromises();

    expect(onSubmitSpy).toHaveBeenCalledWith("From custom slot");
  });

  it("forwards message-view slot with existing messages and welcome-message slot", async () => {
    const agent = new StateCapturingAgent([], "default");
    agent.messages = [
      {
        id: "existing-user-1",
        role: "user",
        content: "Existing message",
      },
    ] as any;

    const { wrapper } = renderWithCopilotKit(
      () =>
        h(
          CopilotChat,
          {
            welcomeScreen: false,
          },
          {
            "message-view": ({ messages }: any) =>
              h(
                "div",
                { "data-testid": "custom-message-view" },
                String(messages.length),
              ),
            "welcome-message": () =>
              h(
                "div",
                { "data-testid": "custom-welcome-message" },
                "Welcome slot",
              ),
          },
        ),
      { agents: { default: agent } },
    );

    expect(wrapper.get("[data-testid='custom-message-view']").text()).toBe("1");

    const welcome = renderWithCopilotKit(
      () =>
        h(
          CopilotChat,
          { welcomeScreen: true },
          {
            "welcome-message": () =>
              h(
                "div",
                { "data-testid": "custom-welcome-message" },
                "Welcome slot",
              ),
          },
        ),
      { agents: { default: new StateCapturingAgent([], "default") } },
    );
    expect(
      welcome.wrapper.find("[data-testid='custom-welcome-message']").exists(),
    ).toBe(true);
  });

  it("resolves explicit agentId and threadId props over inherited config", async () => {
    const defaultAgent = new StateCapturingAgent([], "default");
    const customAgent = new StateCapturingAgent([], "custom-agent");

    const { wrapper } = renderWithCopilotKit(
      () =>
        h(CopilotChat, {
          agentId: "custom-agent",
          threadId: "explicit-thread",
          welcomeScreen: false,
        }),
      {
        agents: {
          default: defaultAgent,
          "custom-agent": customAgent,
        },
        configProps: {
          agentId: "default",
          threadId: "inherited-thread",
        },
      },
    );

    const textarea = wrapper.get("textarea");
    await textarea.setValue("hello");
    await textarea.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(defaultAgent.messages).toHaveLength(0);
    expect(customAgent.threadId).toBe("explicit-thread");
    expect(customAgent.messages.some((m) => m.role === "user")).toBe(true);
  });
});
