import { defineComponent, ref } from "vue";
import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

const AGENT_ID = "default";
const THREAD_ID = "thread-test";

function toolCall(id: string, name = "approve"): ToolCall {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function assistantMsg(id: string, content?: string, toolCalls?: ToolCall[]) {
  return { id, role: "assistant" as const, content, toolCalls } as Message;
}

/**
 * Renders the view over a reactive message list and returns a setter, so a test
 * can swap the list on the SAME mounted instance. Row teardown-vs-reuse is only
 * observable that way — comparing DOM node identity across an update.
 */
function renderWithSwappableMessages(initial: Message[]) {
  const messages = ref<Message[]>(initial);

  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
    },
    setup() {
      return { messages, agentId: AGENT_ID, threadId: THREAD_ID };
    },
    template: `
      <CopilotKitProvider runtime-url="/api/copilotkit">
        <CopilotChatConfigurationProvider :agent-id="agentId" :thread-id="threadId">
          <CopilotChatMessageView :messages="messages" />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  render(Host);

  return {
    async setMessages(next: Message[]) {
      messages.value = next;
      // Let Vue flush the patch (and the post-flush prune watcher).
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function assistantRow() {
  return screen.getByTestId("copilot-assistant-message");
}

describe("CopilotChatMessageView stable row keys", () => {
  it("reuses the row when the message id changes but a tool call is stable", async () => {
    const { setMessages } = renderWithSwappableMessages([
      assistantMsg("lc_run--1", "Working...", [toolCall("call_A")]),
    ]);
    const node = assistantRow();

    await setMessages([assistantMsg("resp_1", "Done", [toolCall("call_A")])]);

    expect(assistantRow()).toBe(node);
    expect(assistantRow().textContent).toContain("Done");
  });

  it("does not tear down the row when a tool call arrives mid-stream", async () => {
    // Regression guard: keying by the tool-call id instead of recording an
    // override tears the row down here, for every provider.
    const { setMessages } = renderWithSwappableMessages([
      assistantMsg("lc_run--1", "Let me check that..."),
    ]);
    const node = assistantRow();

    await setMessages([
      assistantMsg("lc_run--1", "Let me check that...", [toolCall("call_A")]),
    ]);

    expect(assistantRow()).toBe(node);
  });

  it("survives the whole sequence: text, then tool call, then id re-key", async () => {
    const { setMessages } = renderWithSwappableMessages([
      assistantMsg("lc_run--1", "Let me check..."),
    ]);
    const node = assistantRow();

    await setMessages([
      assistantMsg("lc_run--1", "Let me check...", [toolCall("call_A")]),
    ]);
    expect(assistantRow()).toBe(node);

    await setMessages([assistantMsg("resp_1", "Done", [toolCall("call_A")])]);
    expect(assistantRow()).toBe(node);
  });

  it("tears down a text-only row on an id change (documented limitation)", async () => {
    const { setMessages } = renderWithSwappableMessages([
      assistantMsg("lc_run--1", "Working..."),
    ]);
    const node = assistantRow();

    await setMessages([assistantMsg("resp_1", "Done")]);

    expect(assistantRow()).not.toBe(node);
  });

  it("renders both rows when a tool-call id is shared", async () => {
    renderWithSwappableMessages([
      assistantMsg("a-1", "First", [toolCall("call_X")]),
      assistantMsg("a-2", "Second", [toolCall("call_X")]),
    ]);

    const rows = screen.getAllByTestId("copilot-assistant-message");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("First");
    expect(rows[1]!.textContent).toContain("Second");
  });

  it("keeps the first row when the list grows around it", async () => {
    const { setMessages } = renderWithSwappableMessages([
      assistantMsg("lc_run--1", "First", [toolCall("call_A")]),
    ]);
    const node = assistantRow();

    await setMessages([
      assistantMsg("resp_1", "First", [toolCall("call_A")]),
      assistantMsg("lc_run--2", "Second", [toolCall("call_B", "b")]),
    ]);

    expect(screen.getAllByTestId("copilot-assistant-message")[0]).toBe(node);
  });
});
