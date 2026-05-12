import { of } from "rxjs";
import { vi } from "vitest";
import { LangGraphAgent } from "../agent";

// REGRESSION: `@ag-ui/langgraph`'s message converter only handles
// {user, assistant, system, tool} and throws "message role is not
// supported." on anything else. Reasoning-stream agents (OpenAI
// Responses API with `reasoning={summary:"detailed"}`) emit AG-UI
// messages with `role:"reasoning"` that the AG-UI client persists in
// the thread and replays on the NEXT turn's `input.messages` — which
// crashes the converter before the model is called.
//
// CopilotKit's LangGraphAgent.run subclass strips those reasoning
// messages from the inbound `input.messages` before delegating to
// super. This file verifies that filter:
//   - `role:"reasoning"` is dropped.
//   - All other roles (user, assistant, system, tool, plus unknown
//     roles we don't recognize) are preserved in order.
//   - The pre-existing forwardedProps enrichment (`streamSubgraphs`)
//     still applies.

function createAgent() {
  return new LangGraphAgent({
    graphId: "test-graph",
    url: "http://localhost:8000",
  });
}

/**
 * Mock the parent class's `run` method for a single test so we can
 * capture the `input` it receives without actually opening a stream.
 * The harness spies on the prototype TWO levels up because the
 * CopilotKit `LangGraphAgent` extends `@ag-ui/langgraph`'s
 * `LangGraphAgent`. Mirror the pattern from
 * `dispatch-event-filtering.test.ts`'s `withMockedParentMerge`.
 */
function withMockedParentRun(agent: LangGraphAgent) {
  const parentProto = Object.getPrototypeOf(Object.getPrototypeOf(agent));
  const calls: any[] = [];
  const spy = vi.spyOn(parentProto, "run").mockImplementation(function (
    this: unknown,
    input: unknown,
  ) {
    calls.push(input);
    // Return an empty Observable — none of our assertions consume it,
    // we only care about what was passed in.
    return of();
  });
  return { spy, calls };
}

function makeInput(messages: Array<{ role: string; id?: string }>) {
  return {
    runId: "run-1",
    threadId: "thread-1",
    messages,
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  } as any;
}

describe("LangGraphAgent.run reasoning-role message filtering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips role:'reasoning' messages from input before delegating to super.run", () => {
    const agent = createAgent();
    const { calls } = withMockedParentRun(agent);

    agent.run(
      makeInput([
        { role: "user", id: "u1" },
        { role: "reasoning", id: "r1" },
        { role: "assistant", id: "a1" },
        { role: "tool", id: "t1" },
        { role: "reasoning", id: "r2" },
      ]),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].messages.map((m: { id: string }) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
    ]);
    expect(
      calls[0].messages.some((m: { role: string }) => m.role === "reasoning"),
    ).toBe(false);
  });

  it("preserves user/assistant/system/tool messages in their original order", () => {
    const agent = createAgent();
    const { calls } = withMockedParentRun(agent);

    agent.run(
      makeInput([
        { role: "system", id: "s1" },
        { role: "user", id: "u1" },
        { role: "assistant", id: "a1" },
        { role: "tool", id: "t1" },
        { role: "user", id: "u2" },
      ]),
    );

    expect(calls[0].messages.map((m: { id: string }) => m.id)).toEqual([
      "s1",
      "u1",
      "a1",
      "t1",
      "u2",
    ]);
  });

  it("tolerates an empty messages array without throwing", () => {
    const agent = createAgent();
    const { calls } = withMockedParentRun(agent);

    agent.run(makeInput([]));

    expect(calls[0].messages).toEqual([]);
  });

  it("tolerates omitted messages (defaults to empty array)", () => {
    const agent = createAgent();
    const { calls } = withMockedParentRun(agent);

    const input = makeInput([{ role: "user", id: "u1" }]);
    delete input.messages;
    agent.run(input);

    expect(calls[0].messages).toEqual([]);
  });

  it("preserves the pre-existing forwardedProps.streamSubgraphs default", () => {
    const agent = createAgent();
    const { calls } = withMockedParentRun(agent);

    agent.run(makeInput([{ role: "user", id: "u1" }]));

    expect(calls[0].forwardedProps).toMatchObject({ streamSubgraphs: true });
  });

  it("respects an explicit forwardedProps.streamSubgraphs=false", () => {
    const agent = createAgent();
    const { calls } = withMockedParentRun(agent);

    const input = makeInput([{ role: "user", id: "u1" }]);
    input.forwardedProps = { streamSubgraphs: false };
    agent.run(input);

    expect(calls[0].forwardedProps.streamSubgraphs).toBe(false);
  });
});
