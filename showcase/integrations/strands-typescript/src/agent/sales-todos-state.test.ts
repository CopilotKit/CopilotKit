/**
 * The sales pipeline lives in two places, and they must agree.
 *
 * `salesStateFromArgs` streams the list to the UI as a STATE_SNAPSHOT, which
 * is transport only: nothing about it survives a restart. The durable copy is
 * the one `manage_sales_todos` writes into the Strands agent's `appState`,
 * which a configured SessionManager persists and restores with the thread.
 *
 * The tool runs inside a real Strands `Agent` here, driven by a scripted model,
 * so the tool context it writes through is the one the SDK really hands it.
 */

import { describe, expect, it } from "vitest";
import { Agent, Model } from "@strands-agents/sdk";
import type {
  BaseModelConfig,
  Message,
  ModelStreamEvent,
} from "@strands-agents/sdk";
import type { ToolCallContext } from "@ag-ui/aws-strands";

import { manageSalesTodos } from "./tools";
import { SALES_TODOS_STATE_KEY, salesStateFromArgs } from "./state";

type Call = { toolUseId: string; input: unknown };

/** Replays one `manage_sales_todos` call per scripted turn, then ends the turn. */
class ScriptedModel extends Model<BaseModelConfig> {
  private readonly calls: Call[];
  private config: BaseModelConfig = { modelId: "scripted" };

  constructor(calls: Call[]) {
    super();
    this.calls = [...calls];
  }

  updateConfig(config: BaseModelConfig): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): BaseModelConfig {
    return this.config;
  }

  async *stream(_messages: Message[]): AsyncIterable<ModelStreamEvent> {
    const call = this.calls.shift();
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (call) {
      yield {
        type: "modelContentBlockStartEvent",
        start: {
          type: "toolUseStart",
          name: "manage_sales_todos",
          toolUseId: call.toolUseId,
        },
      };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: { type: "toolUseInputDelta", input: JSON.stringify(call.input) },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      return;
    }
    yield { type: "modelContentBlockStartEvent" };
    yield {
      type: "modelContentBlockDeltaEvent",
      delta: { type: "textDelta", text: "Done." },
    };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}

/** Run one agent invocation that makes `calls`, one per model turn. */
async function runCalls(calls: Call[]): Promise<Agent> {
  const agent = new Agent({
    model: new ScriptedModel(calls),
    tools: [manageSalesTodos],
    printer: false,
  });
  await agent.invoke("update the pipeline");
  return agent;
}

/** The result text each `manage_sales_todos` call handed back to the model. */
function toolResultTexts(agent: Agent): string[] {
  return agent.messages.flatMap((message) =>
    message.content.flatMap((block) =>
      block.type === "toolResultBlock"
        ? block.content.flatMap((part) =>
            part.type === "textBlock" ? [part.text] : [],
          )
        : [],
    ),
  );
}

/** What the UI is sent for the same call. */
async function uiSnapshotTodos(call: Call): Promise<unknown> {
  const snapshot = await salesStateFromArgs({
    toolUseId: call.toolUseId,
    toolInput: call.input,
  } as ToolCallContext);
  return snapshot?.todos;
}

const FIRST: Call = {
  toolUseId: "call-first",
  input: {
    todos: [
      { id: "st-001", title: "Call Acme about renewal", value: 50000 },
      { title: "Send DataViz contract", stage: "negotiation" },
    ],
  },
};

const SECOND: Call = {
  toolUseId: "call-second",
  input: {
    todos: [
      {
        id: "st-001",
        title: "Call Acme about renewal",
        value: 50000,
        completed: true,
      },
    ],
  },
};

describe("manage_sales_todos durable state", () => {
  it("keeps the processed list in the agent's app state", async () => {
    const agent = await runCalls([FIRST]);

    expect(agent.appState.get(SALES_TODOS_STATE_KEY)).toEqual([
      {
        id: "st-001",
        title: "Call Acme about renewal",
        stage: "prospect",
        value: 50000,
        dueDate: "",
        assignee: "",
        completed: false,
      },
      {
        id: expect.any(String),
        title: "Send DataViz contract",
        stage: "negotiation",
        value: 0,
        dueDate: "",
        assignee: "",
        completed: false,
      },
    ]);
  });

  it("stores exactly what the UI is shown, generated ids included", async () => {
    const agent = await runCalls([FIRST]);

    expect(agent.appState.get(SALES_TODOS_STATE_KEY)).toEqual(
      await uiSnapshotTodos(FIRST),
    );
  });

  it("holds only the latest list after repeated updates", async () => {
    const agent = await runCalls([FIRST, SECOND]);

    expect(agent.appState.get(SALES_TODOS_STATE_KEY)).toEqual(
      await uiSnapshotTodos(SECOND),
    );
    expect(agent.appState.keys()).toEqual([SALES_TODOS_STATE_KEY]);
  });

  it("still answers the model with the same summary", async () => {
    const agent = await runCalls([FIRST, SECOND]);

    expect(toolResultTexts(agent)).toEqual([
      "Sales todos updated. Tracking 2 item(s).",
      "Sales todos updated. Tracking 1 item(s).",
    ]);
  });
});
