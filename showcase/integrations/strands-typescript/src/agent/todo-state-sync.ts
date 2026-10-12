import { AsyncLocalStorage } from "node:async_hooks";
import { BeforeInvocationEvent } from "@strands-agents/sdk";
import type { Agent, Plugin } from "@strands-agents/sdk";
import { StrandsAgent } from "@ag-ui/aws-strands";
import type { StrandsAgentOptions } from "@ag-ui/aws-strands";
import type { RunAgentInput } from "@ag-ui/core";
import { manageTodosImpl } from "../../shared-tools/todos";
import type { BoardTodo } from "../../shared-tools/todos";

const requestedTodos = new AsyncLocalStorage<BoardTodo[] | undefined>();

const syncBoardTodos: Plugin = {
  name: "sync-board-todos",
  initAgent(agent: Agent) {
    agent.addHook(BeforeInvocationEvent, (event) => {
      const todos = requestedTodos.getStore();
      if (todos !== undefined) event.agent.appState.set("todos", todos);
    });
  },
};

/** Apply frontend edits after native session restoration, before tools can read. */
export class BoardStateStrandsAgent extends StrandsAgent {
  constructor(options: StrandsAgentOptions) {
    super({
      ...options,
      plugins: [...(options.plugins ?? []), syncBoardTodos],
    });
  }

  override async *run(input: RunAgentInput) {
    const todos = Array.isArray(input.state?.todos)
      ? manageTodosImpl(input.state.todos)
      : undefined;
    const stream = super.run(input);
    // The endpoint may pull successive events from separate async contexts.
    // Scope each pull so concurrent conversations cannot share board edits.
    try {
      while (true) {
        const next = await requestedTodos.run(todos, () => stream.next());
        if (next.done) return;
        yield next.value;
      }
    } finally {
      await requestedTodos.run(todos, () => stream.return());
    }
  }
}
