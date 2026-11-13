import { randomUUID } from "node:crypto";
import { AIMessage, isToolMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { graph } from "./beautiful-chat";
import type { BeautifulChatState } from "./beautiful-chat";

const savedTodos: BeautifulChatState["todos"] = [
  {
    id: "4e773deb-dbae-4578-a8f3-6dea25033609",
    title: "PR2921 TS review",
    description: "cedar checkpoint",
    emoji: "🌲",
    status: "pending",
  },
  {
    id: "untouched-todo",
    title: "Keep this task",
    description: "Preserve every field",
    status: "completed",
  },
];

function createSession(
  checkpointer = new MemorySaver(),
  threadId = randomUUID(),
) {
  // Exercise the production graph and ToolNode without an LLM: seed a real
  // checkpoint at the chat/tool boundary, then stop after tool execution.
  const agent = graph.builder.compile({
    checkpointer,
    interruptAfter: ["tool_node"],
  });
  const emittedStates: unknown[] = [];
  const config = {
    configurable: { thread_id: threadId },
    callbacks: [
      {
        handleCustomEvent(name: string, data: unknown) {
          if (name === "copilotkit_manually_emit_intermediate_state")
            emittedStates.push(data);
        },
      },
    ],
  };

  async function callTool(
    name: string,
    args: { todos?: BeautifulChatState["todos"] } = {},
    todos?: BeautifulChatState["todos"],
  ) {
    const callId = randomUUID();
    await agent.updateState(
      config,
      {
        ...(todos === undefined ? {} : { todos }),
        messages: [
          new AIMessage({
            content: "",
            tool_calls: [{ id: callId, name, args, type: "tool_call" }],
          }),
        ],
      },
      "chat_node",
    );
    const result = await agent.invoke(null, config);
    const message = result.messages.find(
      (candidate) =>
        isToolMessage(candidate) && candidate.tool_call_id === callId,
    );
    expect(message).toBeDefined();
    return { result, content: message?.content };
  }

  return { agent, config, callTool, checkpointer, threadId, emittedStates };
}

describe("beautiful-chat checkpointed todo tools", () => {
  it("returns exact persisted todos even without descriptive message history", async () => {
    const session = createSession();
    const { result, content } = await session.callTool(
      "get_todos",
      {},
      savedTodos,
    );
    expect(content).toBe(JSON.stringify(savedTodos));
    expect(result.todos).toEqual(savedTodos);
  });

  it.each([undefined, []])(
    "returns an empty list for empty state (%j)",
    async (todos) => {
      const { content } = await createSession().callTool(
        "get_todos",
        {},
        todos,
      );
      expect(content).toBe("[]");
    },
  );

  it("reads updates on the next turn, preserving original IDs and untouched items", async () => {
    const session = createSession();
    const updated = [
      { ...savedTodos[0], status: "completed" as const },
      savedTodos[1],
      {
        title: "New task",
        description: "new description",
        status: "pending" as const,
      },
    ];
    const { result } = await session.callTool(
      "manage_todos",
      { todos: updated },
      savedTodos,
    );
    expect(session.emittedStates).toEqual([{ todos: result.todos }]);
    expect(result.todos.slice(0, 2)).toEqual(updated.slice(0, 2));
    expect(result.todos[2]).toEqual({ ...updated[2], id: expect.any(String) });
    expect(result.todos[2].id).not.toBe(savedTodos[0].id);
    const { content } = await session.callTool("get_todos");
    expect(content).toBe(JSON.stringify(result.todos));
  });

  it("reads imported checkpoint state after rebuilding the graph and saver", async () => {
    const session = createSession();
    await session.callTool("get_todos", {}, savedTodos);
    const checkpoint = await session.checkpointer.getTuple(session.config);
    if (!checkpoint) throw new Error("Expected a persisted native checkpoint");
    const restoredSaver = new MemorySaver();
    await restoredSaver.put(
      session.config,
      checkpoint.checkpoint,
      checkpoint.metadata!,
    );
    const restored = createSession(restoredSaver, session.threadId);
    const { content } = await restored.callTool("get_todos");
    expect(content).toBe(JSON.stringify(savedTodos));
  });
});
