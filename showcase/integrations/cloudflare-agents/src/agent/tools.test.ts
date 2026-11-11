import { describe, expect, it } from "vitest";
import { scriptedModel, toolOptions } from "./test-support/mock-model";
import type { ScriptedReply } from "./test-support/mock-model";
import { SUBAGENT_FAILURE_PREFIX, showcaseTools } from "./tools";
import type { ShowcaseState, StateAccess } from "./tools";

/** In-memory state that records every write, as the agent's setState would stream them. */
function memoryState(initial: ShowcaseState = {}) {
  let current = initial;
  const writes: ShowcaseState[] = [];
  const access: StateAccess = {
    get: () => current,
    set: (state) => {
      current = state;
      writes.push(state);
    },
  };
  return { access, writes, current: () => current };
}

function tools(
  state: StateAccess,
  replies: ScriptedReply[] = [{ text: "ok" }],
) {
  return showcaseTools({ state, model: () => scriptedModel(replies) });
}

const options = toolOptions;

describe("showcaseTools state tools", () => {
  it("set_notes and set_steps replace their slot and keep the rest of the state", async () => {
    const state = memoryState({ preferences: { name: "Ada" } });
    const set = tools(state.access);
    await set.set_notes.execute!({ notes: ["likes blue"] }, options());
    await set.set_steps.execute!(
      { steps: [{ id: "step-1", title: "Plan", status: "pending" }] },
      options(),
    );
    expect(state.current()).toEqual({
      preferences: { name: "Ada" },
      notes: ["likes blue"],
      steps: [{ id: "step-1", title: "Plan", status: "pending" }],
    });
  });

  it("manage_sales_todos names new items after the call and normalises legacy fields", async () => {
    const state = memoryState();
    const set = tools(state.access);
    await set.manage_sales_todos.execute!(
      {
        todos: [
          { id: "st-001", title: "Follow up", completed: true },
          { title: "New lead", notes: "from the demo" },
        ],
      },
      options("call-7"),
    );
    expect(state.current().todos).toEqual([
      {
        id: "st-001",
        title: "Follow up",
        description: "",
        emoji: "🎯",
        status: "completed",
      },
      {
        id: "call-7-1",
        title: "New lead",
        notes: "from the demo",
        description: "from the demo",
        emoji: "🎯",
        status: "pending",
      },
    ]);
  });

  it("get_sales_todos reads the board, empty when there is none", async () => {
    const empty = tools(memoryState().access);
    await expect(
      empty.get_sales_todos.execute!({}, options()),
    ).resolves.toEqual([]);
    const board = [{ id: "a", title: "x" }];
    const filled = tools(memoryState({ todos: board }).access);
    await expect(
      filled.get_sales_todos.execute!({}, options()),
    ).resolves.toEqual(board);
  });

  it("write_document streams the document into state as the arguments arrive", async () => {
    const state = memoryState();
    const write = tools(state.access).write_document;
    const delta = toolOptions();
    await write.onInputStart!(delta);
    for (const inputTextDelta of [
      '{"docu',
      'ment": "Autumn',
      " leaves",
      ' fall"}',
    ]) {
      await write.onInputDelta!({ ...delta, inputTextDelta });
    }
    await write.execute!({ document: "Autumn leaves fall" }, options());

    const documents = state.writes.map((s) => s.document);
    expect(documents).toEqual([
      "Autumn",
      "Autumn leaves",
      "Autumn leaves fall",
    ]);
  });
});

describe("showcaseTools sub-agents", () => {
  it("appends a completed delegation with the sub-agent's answer", async () => {
    const state = memoryState({ delegations: [{ id: "old" }] });
    const set = tools(state.access, [{ text: "- fact one\n- fact two" }]);
    const result = await set.research_agent.execute!(
      { task: "Benefits of remote work" },
      options(),
    );
    expect(result).toBe("- fact one\n- fact two");
    const delegations = state.current().delegations as Array<
      Record<string, unknown>
    >;
    expect(delegations).toHaveLength(2);
    expect(delegations[1]).toMatchObject({
      sub_agent: "research_agent",
      task: "Benefits of remote work",
      status: "completed",
      result: "- fact one\n- fact two",
    });
  });

  it("logs a failed delegation instead of failing the run", async () => {
    const state = memoryState();
    const set = tools(state.access, [
      { error: new TypeError("connection refused") },
    ]);
    const result = await set.critique_agent.execute!(
      { task: "Draft" },
      options(),
    );
    expect(result).toBe(`${SUBAGENT_FAILURE_PREFIX} (TypeError).`);
    expect(state.current().delegations).toEqual([
      expect.objectContaining({
        sub_agent: "critique_agent",
        status: "failed",
      }),
    ]);
  });
});
