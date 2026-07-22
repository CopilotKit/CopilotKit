import type { RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import {
  ContextHttpAgent,
  type ContextHttpAgentOptions,
} from "./context-http-agent";

class TestableContextHttpAgent extends ContextHttpAgent {
  buildRequestBody(input: RunAgentInput): RunAgentInput {
    const init = this.requestInit(input);
    return JSON.parse(init.body as string) as RunAgentInput;
  }
}

function createAgent(options: ContextHttpAgentOptions = {}) {
  return new TestableContextHttpAgent(
    { agentId: "pilot", url: "http://localhost:9000/agent", threadId: "t-1" },
    options,
  );
}

function runInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "t-1",
    runId: "r-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  };
}

const userMessage = (id: string, content: string) =>
  ({ id, role: "user", content }) as RunAgentInput["messages"][number];

describe("ContextHttpAgent", () => {
  it("attaches persistent context entries to every run", () => {
    const agent = createAgent({
      context: () => [{ description: "User Profile", value: "Jane" }],
    });

    const body = agent.buildRequestBody(runInput());

    expect(body.context).toEqual([
      { description: "User Profile", value: "Jane" },
    ]);
  });

  it("lets run context win over persistent entries with the same description", () => {
    const agent = createAgent({
      context: () => [
        { description: "User Profile", value: "stale" },
        { description: "Catalog", value: "cat-1" },
      ],
    });

    const body = agent.buildRequestBody(
      runInput({
        context: [{ description: "User Profile", value: "fresh" }],
      }),
    );

    expect(body.context).toEqual([
      { description: "Catalog", value: "cat-1" },
      { description: "User Profile", value: "fresh" },
    ]);
  });

  it("evaluates the context callback per request", () => {
    let value = "first";
    const agent = createAgent({
      context: () => [{ description: "Snapshot", value }],
    });

    expect(agent.buildRequestBody(runInput()).context[0].value).toBe("first");
    value = "second";
    expect(agent.buildRequestBody(runInput()).context[0].value).toBe("second");
  });

  it("merges forwarded props with per-run props taking precedence", () => {
    const agent = createAgent({
      forwardedProps: () => ({ locale: "de-AT", theme: "dark" }),
    });

    const body = agent.buildRequestBody(
      runInput({ forwardedProps: { theme: "light" } }),
    );

    expect(body.forwardedProps).toEqual({ locale: "de-AT", theme: "light" });
  });

  it("sends the full history when useServerMemory is off", () => {
    const agent = createAgent();
    const messages = [userMessage("m-1", "hi"), userMessage("m-2", "again")];

    agent.buildRequestBody(runInput({ messages }));
    const body = agent.buildRequestBody(runInput({ messages }));

    expect(body.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
  });

  it("sends each message only once when useServerMemory is on", () => {
    const agent = createAgent({ useServerMemory: true });

    const first = agent.buildRequestBody(
      runInput({ messages: [userMessage("m-1", "hi")] }),
    );
    const second = agent.buildRequestBody(
      runInput({
        messages: [userMessage("m-1", "hi"), userMessage("m-2", "again")],
      }),
    );

    expect(first.messages.map((message) => message.id)).toEqual(["m-1"]);
    expect(second.messages.map((message) => message.id)).toEqual(["m-2"]);
  });

  it("resends the full history after clearSentHistory", () => {
    const agent = createAgent({ useServerMemory: true });
    const messages = [userMessage("m-1", "hi"), userMessage("m-2", "again")];

    agent.buildRequestBody(runInput({ messages }));
    agent.clearSentHistory();
    const body = agent.buildRequestBody(runInput({ messages }));

    expect(body.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
  });

  it("does not alter messages, context, or props beyond the configured merges", () => {
    const agent = createAgent();
    const input = runInput({
      messages: [userMessage("m-1", "hi")],
      context: [{ description: "Run", value: "only" }],
      forwardedProps: { theme: "light" },
    });

    const body = agent.buildRequestBody(input);

    expect(body.messages).toEqual(input.messages);
    expect(body.context).toEqual(input.context);
    expect(body.forwardedProps).toEqual(input.forwardedProps);
  });
});
