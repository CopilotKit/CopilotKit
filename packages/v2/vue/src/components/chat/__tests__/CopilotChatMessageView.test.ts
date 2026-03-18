import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type {
  ActivityMessage,
  AssistantMessage,
  Message,
  ToolMessage,
} from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import { CopilotChatDefaultLabels } from "../../../providers/types";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

type CopilotKitCoreTestAccess = {
  notifySubscribers: (
    handler: (subscriber: {
      onRuntimeConnectionStatusChanged?: () => void | Promise<void>;
    }) => void | Promise<void>,
    errorMessage: string,
  ) => Promise<void>;
};

function mountMessageView(
  messages: Message[],
  slotEntries: Parameters<typeof h>[2] = {},
) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", agentId: "default" },
          {
            default: () => h(CopilotChatMessageView, { messages }, slotEntries),
          },
        ),
    },
  });
}

describe("CopilotChatMessageView (Vue slots)", () => {
  it("renders default assistant and user components when no custom slots are passed", () => {
    const messages: Message[] = [
      {
        id: "user-default",
        role: "user",
        content: "hello user",
      } as Message,
      {
        id: "assistant-default",
        role: "assistant",
        content: "hello assistant",
      } as AssistantMessage,
    ];

    const wrapper = mountMessageView(messages);

    expect(wrapper.find('[data-message-id="user-default"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-message-id="assistant-default"]').exists()).toBe(
      true,
    );
    expect(
      wrapper
        .find(
          `[aria-label="${CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel}"]`,
        )
        .exists(),
    ).toBe(true);
  });

  it("renders named activity slot when activity type matches", () => {
    const messages: Message[] = [
      {
        id: "act-1",
        role: "activity",
        activityType: "search-progress",
        content: { percent: 42 },
      } as ActivityMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "activity-search-progress": ({
        content,
      }: {
        content: { percent: number };
      }) =>
        h(
          "div",
          { "data-testid": "activity-rendered" },
          `Progress: ${content.percent}`,
        ),
    });

    expect(wrapper.find("[data-testid=activity-rendered]").text()).toContain(
      "42",
    );
  });

  it("falls back to generic activity slot when named slot is absent", () => {
    const messages: Message[] = [
      {
        id: "act-2",
        role: "activity",
        activityType: "build-progress",
        content: { step: "compile" },
      } as ActivityMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "activity-message": ({ activityType }: { activityType: string }) =>
        h("div", { "data-testid": "activity-fallback" }, activityType),
    });

    expect(wrapper.find("[data-testid=activity-fallback]").text()).toBe(
      "build-progress",
    );
  });

  it("prefers named activity slot over generic fallback slot", () => {
    const messages: Message[] = [
      {
        id: "act-3",
        role: "activity",
        activityType: "search-progress",
        content: { percent: 75 },
      } as ActivityMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "activity-search-progress": () =>
        h("div", { "data-testid": "activity-named-precedence" }, "named"),
      "activity-message": () =>
        h("div", { "data-testid": "activity-fallback-precedence" }, "fallback"),
    });

    expect(wrapper.find("[data-testid=activity-named-precedence]").text()).toBe(
      "named",
    );
    expect(
      wrapper.find("[data-testid=activity-fallback-precedence]").exists(),
    ).toBe(false);
  });

  it("renders built-in MCP fallback when no activity slot exists", async () => {
    const messages: Message[] = [
      {
        id: "act-mcp",
        role: "activity",
        activityType: "mcp-apps",
        content: {
          resourceUri: "ui://server/dashboard",
          serverHash: "abc123",
          result: {},
        },
      } as ActivityMessage,
    ];

    const wrapper = mountMessageView(messages);
    await nextTick();

    expect(wrapper.text()).toContain("No agent available to fetch resource");
  });

  it("prefers generic activity slot over built-in MCP fallback", () => {
    const messages: Message[] = [
      {
        id: "act-mcp-fallback",
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
        h("div", { "data-testid": "generic-activity-over-mcp" }, "generic"),
    });

    expect(wrapper.find("[data-testid=generic-activity-over-mcp]").text()).toBe(
      "generic",
    );
    expect(wrapper.text()).not.toContain(
      "No agent available to fetch resource",
    );
  });

  it("renders built-in A2UI fallback only when runtime reports a2ui enabled", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const messages: Message[] = [
      {
        id: "act-a2ui",
        role: "activity",
        activityType: "a2ui-surface",
        content: {
          operations: [
            {
              beginRendering: {
                surfaceId: "surface-1",
                root: "root",
                styles: {},
              },
            },
          ],
        },
      } as ActivityMessage,
    ];

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
                  h(Probe),
                  h(CopilotChatMessageView, { messages }),
                ]),
            },
          ),
      },
    });

    await nextTick();
    expect(wrapper.find("[data-testid=a2ui-activity-renderer]").exists()).toBe(
      false,
    );

    Object.defineProperty(core as object, "a2uiEnabled", {
      configurable: true,
      get: () => true,
    });
    await (core as unknown as CopilotKitCoreTestAccess).notifySubscribers(
      (subscriber) => subscriber.onRuntimeConnectionStatusChanged?.(),
      "test runtime a2ui enabled",
    );
    await nextTick();

    expect(wrapper.find("[data-testid=a2ui-activity-renderer]").exists()).toBe(
      true,
    );
    expect(wrapper.find("[data-testid=a2ui-surface]").attributes("data-surface-id")).toBe(
      "surface-1",
    );
  });

  it("prefers generic activity slot over built-in A2UI fallback", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const messages: Message[] = [
      {
        id: "act-a2ui-override",
        role: "activity",
        activityType: "a2ui-surface",
        content: {
          operations: [{ beginRendering: { surfaceId: "surface-2", root: "root" } }],
        },
      } as ActivityMessage,
    ];

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
                  h(Probe),
                  h(
                    CopilotChatMessageView,
                    { messages },
                    {
                      "activity-message": () =>
                        h("div", { "data-testid": "activity-over-a2ui" }, "generic"),
                    },
                  ),
                ]),
            },
          ),
      },
    });

    Object.defineProperty(core as object, "a2uiEnabled", {
      configurable: true,
      get: () => true,
    });
    await (core as unknown as CopilotKitCoreTestAccess).notifySubscribers(
      (subscriber) => subscriber.onRuntimeConnectionStatusChanged?.(),
      "test runtime a2ui enabled for override",
    );
    await nextTick();

    expect(wrapper.find("[data-testid=activity-over-a2ui]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=a2ui-activity-renderer]").exists()).toBe(
      false,
    );
  });

  it("uses named tool slot over generic tool slot", () => {
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
        h("div", { "data-testid": "tool-named" }, status),
      "tool-call": () =>
        h("div", { "data-testid": "tool-fallback" }, "fallback"),
    });

    expect(wrapper.find("[data-testid=tool-named]").text()).toBe("inProgress");
    expect(wrapper.find("[data-testid=tool-fallback]").exists()).toBe(false);
  });

  it("renders generic tool slot when no named slot exists", () => {
    const messages: Message[] = [
      {
        id: "assistant-2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-2",
            type: "function",
            function: {
              name: "unknown_tool",
              arguments: JSON.stringify({ value: 1 }),
            },
          },
        ],
      } as AssistantMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "tool-call": ({ name }: { name: string }) =>
        h("div", { "data-testid": "tool-fallback" }, name),
    });

    expect(wrapper.find("[data-testid=tool-fallback]").text()).toBe(
      "unknown_tool",
    );
  });

  it("provides before/after message scoped slots with run metadata", () => {
    const messages: Message[] = [
      {
        id: "assistant-3",
        role: "assistant",
        content: "hello",
      } as AssistantMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "message-before": ({ runId }: { runId: string }) =>
        h("div", { "data-testid": "before-run" }, runId),
      "message-after": ({ runId }: { runId: string }) =>
        h("div", { "data-testid": "after-run" }, runId),
    });

    expect(wrapper.find("[data-testid=before-run]").text()).toBe(
      "missing-run-id:assistant-3",
    );
    expect(wrapper.find("[data-testid=after-run]").text()).toBe(
      "missing-run-id:assistant-3",
    );
  });

  it("passes complete status and result when tool message exists", () => {
    const messages: Message[] = [
      {
        id: "assistant-4",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-3",
            type: "function",
            function: {
              name: "search_docs",
              arguments: JSON.stringify({ query: "done" }),
            },
          },
        ],
      } as AssistantMessage,
      {
        id: "tool-1",
        role: "tool",
        toolCallId: "tc-3",
        content: "finished",
      } as ToolMessage,
    ];

    const wrapper = mountMessageView(messages, {
      "tool-call-search_docs": ({
        status,
        result,
      }: {
        status: string;
        result?: string;
      }) => h("div", { "data-testid": "tool-complete" }, `${status}:${result}`),
    });

    expect(wrapper.find("[data-testid=tool-complete]").text()).toBe(
      "complete:finished",
    );
  });

  it("passes executing status when tool id is in executing set", () => {
    const messages: Message[] = [
      {
        id: "assistant-5",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-4",
            type: "function",
            function: {
              name: "search_docs",
              arguments: JSON.stringify({ query: "run" }),
            },
          },
        ],
      } as AssistantMessage,
    ];

    const SetExecuting = defineComponent({
      setup() {
        const { executingToolCallIds } = useCopilotKit();
        executingToolCallIds.value = new Set(["tc-4"]);
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
                    CopilotChatMessageView,
                    { messages },
                    {
                      "tool-call-search_docs": ({
                        status,
                      }: {
                        status: string;
                      }) =>
                        h("div", { "data-testid": "tool-executing" }, status),
                    },
                  ),
                ]),
            },
          ),
      },
    });

    expect(wrapper.find("[data-testid=tool-executing]").text()).toBe(
      "executing",
    );
  });

  it("maps tool statuses across inProgress, executing, and complete", () => {
    const baseMessage: AssistantMessage = {
      id: "assistant-status-map",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tc-status",
          type: "function",
          function: {
            name: "search_docs",
            arguments: JSON.stringify({ query: "status" }),
          },
        },
      ],
    };

    const inProgressWrapper = mountMessageView([baseMessage], {
      "tool-call-search_docs": ({ status }: { status: string }) =>
        h("div", { "data-testid": "status-value" }, status),
    });
    expect(inProgressWrapper.find("[data-testid=status-value]").text()).toBe(
      "inProgress",
    );

    const SetExecuting = defineComponent({
      setup() {
        const { executingToolCallIds } = useCopilotKit();
        executingToolCallIds.value = new Set(["tc-status"]);
        return () => null;
      },
    });

    const executingWrapper = mount(CopilotKitProvider, {
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
                    CopilotChatMessageView,
                    { messages: [baseMessage] },
                    {
                      "tool-call-search_docs": ({
                        status,
                      }: {
                        status: string;
                      }) => h("div", { "data-testid": "status-value" }, status),
                    },
                  ),
                ]),
            },
          ),
      },
    });
    expect(executingWrapper.find("[data-testid=status-value]").text()).toBe(
      "executing",
    );

    const completeWrapper = mountMessageView(
      [
        baseMessage,
        {
          id: "tool-status-result",
          role: "tool",
          toolCallId: "tc-status",
          content: "done",
        } as ToolMessage,
      ],
      {
        "tool-call-search_docs": ({ status }: { status: string }) =>
          h("div", { "data-testid": "status-value" }, status),
      },
    );
    expect(completeWrapper.find("[data-testid=status-value]").text()).toBe(
      "complete",
    );
  });

  it("passes stable metadata payload to before/after slots", () => {
    const messages: Message[] = [
      {
        id: "meta-user",
        role: "user",
        content: "hello",
      } as Message,
      {
        id: "meta-assistant",
        role: "assistant",
        content: "hi",
      } as AssistantMessage,
    ];

    const beforePayloads: Array<Record<string, unknown>> = [];
    const afterPayloads: Array<Record<string, unknown>> = [];

    mountMessageView(messages, {
      "message-before": (payload: Record<string, unknown>) => {
        beforePayloads.push(payload);
        return h("div");
      },
      "message-after": (payload: Record<string, unknown>) => {
        afterPayloads.push(payload);
        return h("div");
      },
    });

    expect(beforePayloads.length).toBeGreaterThanOrEqual(2);
    expect(afterPayloads.length).toBeGreaterThanOrEqual(2);

    const sampleBefore = beforePayloads[0]!;
    const sampleAfter = afterPayloads[0]!;

    expect(sampleBefore.position).toBe("before");
    expect(sampleAfter.position).toBe("after");
    expect(sampleBefore.agentId).toBe("default");
    expect(sampleAfter.agentId).toBe("default");
    expect(typeof sampleBefore.runId).toBe("string");
    expect(typeof sampleAfter.runId).toBe("string");
    expect(typeof sampleBefore.messageIndex).toBe("number");
    expect(typeof sampleAfter.messageIndexInRun).toBe("number");
    expect(typeof sampleBefore.numberOfMessagesInRun).toBe("number");
    expect(typeof sampleAfter.stateSnapshot).toBe("undefined");
  });

  it("renders interrupt slot after messages and before the cursor", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;

    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const messages: Message[] = [
      {
        id: "assistant-interrupt",
        role: "assistant",
        content: "hello",
      } as AssistantMessage,
    ];

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
                  h(Probe),
                  h(
                    CopilotChatMessageView,
                    { messages, isRunning: true },
                    {
                      interrupt: ({ event }: { event: { value: string } }) =>
                        h("div", { "data-testid": "interrupt-slot" }, event.value),
                    },
                  ),
                ]),
            },
          ),
      },
    });

    core?.setInterruptState({
      event: { name: "on_interrupt", value: "needs approval" },
      result: null,
      resolve: () => undefined,
    });
    await nextTick();

    const html = wrapper.html();
    expect(html.indexOf('data-message-id="assistant-interrupt"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('data-testid="interrupt-slot"')).toBeGreaterThan(
      html.indexOf('data-message-id="assistant-interrupt"'),
    );
    expect(html.indexOf('data-testid="copilot-chat-cursor"')).toBeGreaterThan(
      html.indexOf('data-testid="interrupt-slot"'),
    );
  });
});
