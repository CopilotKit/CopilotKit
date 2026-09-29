import { h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

/**
 * `transformMessages` reshapes the list before anything downstream sees it:
 * row keys and rendering all work off its output. Tool-result lookups
 * deliberately keep using the untransformed `messages` prop, so a transform
 * that hides tool results does not strip them from tool cards. The cursor and
 * the assistant toolbar's "latest" check also read the rendered list, not
 * the raw `messages` prop (#1959).
 */

function userMsg(id: string, content = id): Message {
  return { id, role: "user", content } as Message;
}

function assistantMsg(id: string, content: string, name?: string): Message {
  return { id, role: "assistant", content, name } as Message;
}

function mountView(initial: {
  messages: Message[];
  transformMessages?: (messages: Message[]) => Message[];
  isRunning?: boolean;
}) {
  const state = ref(initial);
  const agent = new StateCapturingAgent();
  const wrapper = mount(CopilotKitProvider, {
    props: { agents__unsafe_dev_only: { default: agent } },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { agentId: "default", threadId: "thread-srm" },
          {
            default: () => h(CopilotChatMessageView, { ...state.value }),
          },
        ),
    },
  });
  return { wrapper, state };
}

// Filters out a message named "math_expert", as a langgraph-supervisor
// worker message would be (#1959).
const hideWorker = (list: Message[]) =>
  list.filter((m) => (m as { name?: string }).name !== "math_expert");

const supervisorTranscript: Message[] = [
  userMsg("u1", "what is 2+2"),
  assistantMsg("w-1", "WORKER_SAYS_FOUR", "math_expert"),
  assistantMsg("sup-2", "SUPERVISOR_SAYS_FOUR", "supervisor"),
];

describe("Vue CopilotChatMessageView transformMessages", () => {
  it("renders every message when no transform is given", () => {
    const { wrapper } = mountView({ messages: supervisorTranscript });
    expect(wrapper.text()).toContain("WORKER_SAYS_FOUR");
    expect(wrapper.text()).toContain("SUPERVISOR_SAYS_FOUR");
  });

  it("hides langgraph-supervisor worker messages by name (#1959)", () => {
    const { wrapper } = mountView({
      messages: supervisorTranscript,
      transformMessages: hideWorker,
    });
    expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
    expect(wrapper.text()).toContain("SUPERVISOR_SAYS_FOUR");
    expect(wrapper.text()).toContain("what is 2+2");
  });

  it("hides a row when a later render adds its name", async () => {
    const unnamed = supervisorTranscript.map((m) =>
      m.id === "w-1" ? { ...m, name: undefined } : m,
    ) as Message[];
    const { wrapper, state } = mountView({
      messages: unnamed,
      transformMessages: hideWorker,
    });
    expect(wrapper.text()).toContain("WORKER_SAYS_FOUR");

    state.value = {
      messages: supervisorTranscript,
      transformMessages: hideWorker,
    };
    await nextTick();
    expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
  });

  it("renders messages in the order the transform returns", () => {
    const { wrapper } = mountView({
      messages: [
        userMsg("u1", "first message"),
        userMsg("u2", "second message"),
      ],
      transformMessages: (list) => [...list].toReversed(),
    });
    const html = wrapper.html();
    expect(html.indexOf("second message")).toBeLessThan(
      html.indexOf("first message"),
    );
  });

  it("keeps tool results available to tool cards when the transform hides them", () => {
    const assistant: AssistantMessage = {
      id: "a-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "getWeather", arguments: '{"location":"Paris"}' },
        },
      ],
    };
    const toolResult: Message = {
      id: "t-1",
      role: "tool",
      toolCallId: "call-1",
      content: "sunny",
    } as Message;

    const agent = new StateCapturingAgent();
    const wrapper = mount(CopilotKitProvider, {
      props: { agents__unsafe_dev_only: { default: agent } },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { agentId: "default", threadId: "thread-srm" },
            {
              default: () =>
                h(
                  CopilotChatMessageView,
                  {
                    messages: [assistant, toolResult],
                    transformMessages: (list: Message[]) =>
                      list.filter((m) => m.role !== "tool"),
                  },
                  {
                    "tool-call": ({ result }: { result: string | undefined }) =>
                      h(
                        "span",
                        { "data-testid": "weather-result" },
                        result ?? "pending",
                      ),
                  },
                ),
            },
          ),
      },
    });

    expect(wrapper.find('[data-testid="weather-result"]').text()).toBe("sunny");
  });

  it("shows the cursor when the last rendered message isn't reasoning, even though the raw last message is", () => {
    const reasoning: Message = {
      id: "r-1",
      role: "reasoning",
      content: "thinking",
    } as Message;

    const { wrapper } = mountView({
      messages: [userMsg("u1"), reasoning],
      isRunning: true,
      transformMessages: (list) => list.filter((m) => m.role !== "reasoning"),
    });

    expect(
      wrapper.find('[data-testid="copilot-loading-cursor"]').exists(),
    ).toBe(true);
  });

  describe("latest message", () => {
    const first = assistantMsg("a-1", "first half");
    const second = assistantMsg("a-2", "second half");
    // Replaces both assistant messages with one it builds, under a new id.
    const mergeAssistants = (list: Message[]): Message[] => [
      {
        id: "merged",
        role: "assistant",
        content: list
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .join(" "),
      } as AssistantMessage,
    ];

    it("treats the last rendered message as the latest, not the last input message", async () => {
      const { wrapper, state } = mountView({
        messages: [first, second],
        isRunning: true,
        transformMessages: mergeAssistants,
      });

      // Streaming: the latest (merged) assistant message hides its toolbar.
      expect(wrapper.text()).toContain("first half second half");
      expect(wrapper.find('[data-testid="copilot-copy-button"]').exists()).toBe(
        false,
      );

      // The run ends, and the merged message must re-render to show it.
      state.value = {
        messages: [first, second],
        isRunning: false,
        transformMessages: mergeAssistants,
      };
      await nextTick();
      expect(wrapper.find('[data-testid="copilot-copy-button"]').exists()).toBe(
        true,
      );
    });
  });

  it("warns in development when the transform returns a duplicate id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mountView({
      messages: [userMsg("m-0"), userMsg("m-1")],
      transformMessages: (list) => [...list, list[0]!],
    });

    expect(
      warn.mock.calls.some(([text]) =>
        String(text).includes('more than one message with id "m-0"'),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("warns only once for a duplicate id that persists across renders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Defined once, so re-renders below reuse the same function reference.
    const appendFirst = (list: Message[]) => [...list, list[0]!];

    const { state } = mountView({
      messages: [userMsg("m-0"), userMsg("m-1")],
      transformMessages: appendFirst,
    });
    await nextTick();

    const countDuplicateWarnings = () =>
      warn.mock.calls.filter(([text]) =>
        String(text).includes('more than one message with id "m-0"'),
      ).length;

    expect(countDuplicateWarnings()).toBe(1);

    // Re-render on an unrelated prop change. The same duplicate persists.
    state.value = {
      messages: [userMsg("m-0"), userMsg("m-1")],
      isRunning: true,
      transformMessages: appendFirst,
    };
    await nextTick();

    expect(countDuplicateWarnings()).toBe(1);
    warn.mockRestore();
  });
});
