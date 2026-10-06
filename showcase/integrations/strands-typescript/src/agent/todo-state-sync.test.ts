import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent, Model, SessionManager, FileStorage } from "@strands-agents/sdk";
import type {
  BaseModelConfig,
  Message,
  ModelStreamEvent,
} from "@strands-agents/sdk";
import type { RunAgentInput } from "@ag-ui/core";
import { BoardStateStrandsAgent } from "./todo-state-sync";
import { getSalesTodos } from "./tools";

/** Every user turn reads native state through the real SDK tool context. */
class ReadTodosModel extends Model<BaseModelConfig> {
  getConfig(): BaseModelConfig {
    return { modelId: "scripted" };
  }
  updateConfig(): void {}
  async *stream(messages: Message[]): AsyncIterable<ModelStreamEvent> {
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (
      messages.at(-1)?.content.some((part) => part.type === "toolResultBlock")
    ) {
      yield { type: "modelContentBlockStartEvent" };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: { type: "textDelta", text: "Read." },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
    } else {
      yield {
        type: "modelContentBlockStartEvent",
        start: {
          type: "toolUseStart",
          name: "get_sales_todos",
          toolUseId: crypto.randomUUID(),
        },
      };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: { type: "toolUseInputDelta", input: "{}" },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
    }
  }
}
const original = [
  {
    id: "cedar",
    title: "Cedar",
    description: "Follow up",
    emoji: "🎯",
    status: "completed",
  },
];
const edited = [{ ...original[0], status: "pending" }];
function input(threadId: string, state: unknown): RunAgentInput {
  return {
    threadId,
    runId: crypto.randomUUID(),
    state,
    messages: [
      { id: crypto.randomUUID(), role: "user", content: "Read my tasks" },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}
async function read(
  adapter: BoardStateStrandsAgent,
  threadId: string,
  state: unknown,
) {
  let result: unknown;
  for await (const event of adapter.run(input(threadId, state))) {
    expect(event.type).not.toBe("RUN_ERROR");
    if (event.type === "TOOL_CALL_RESULT" && "content" in event)
      result = JSON.parse(String(event.content));
  }
  return result;
}

describe("frontend todo edits in native state", () => {
  it("overrides restored state, preserves absent input, and clears an explicit empty list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "todo-state-sync-"));
    try {
      const manager = new SessionManager({
        sessionId: "saved",
        storage: { snapshot: new FileStorage(dir) },
      });
      const saved = new Agent({ model: new ReadTodosModel(), printer: false });
      saved.appState.set("todos", original);
      await manager.saveSnapshot({ target: saved, isLatest: true });
      const adapter = new BoardStateStrandsAgent({
        agent: new Agent({
          model: new ReadTodosModel(),
          tools: [getSalesTodos],
          printer: false,
        }),
        name: "test",
        config: { sessionManagerProvider: () => manager },
      });
      expect(await read(adapter, "saved", { todos: edited })).toEqual(edited);
      expect(await read(adapter, "saved", {})).toEqual(edited);
      expect(await read(adapter, "saved", { todos: [] })).toEqual([]);
      const restored = new Agent({
        model: new ReadTodosModel(),
        printer: false,
      });
      expect(await manager.restoreSnapshot({ target: restored })).toBe(true);
      expect(restored.appState.get("todos")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("isolates concurrent conversations and a later conversation with no board", async () => {
    const adapter = new BoardStateStrandsAgent({
      agent: new Agent({
        model: new ReadTodosModel(),
        tools: [getSalesTodos],
        printer: false,
      }),
      name: "test",
    });
    const [first, second] = await Promise.all([
      read(adapter, "first", { todos: edited }),
      read(adapter, "second", { todos: original }),
    ]);
    expect(first).toEqual(edited);
    expect(second).toEqual(original);
    expect(await read(adapter, "third", {})).toEqual([]);
  });
});
