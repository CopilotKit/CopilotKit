import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import { describe, it, expect } from "vitest";
import type {
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
  RunAgentResult,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";

import { handleRunAgent } from "../handle-run";
import { handleSuggestAgent } from "../handle-suggest";
import { handleListThreads } from "../handle-threads";
import { CopilotRuntime } from "../../core/runtime";
import { InMemoryAgentRunner } from "../../runner/in-memory";

/**
 * Stub agent (no real LLM). A normal `agent/run` drives it through the
 * `InMemoryAgentRunner`, which persists a historic run and makes the thread
 * visible in `listThreads`. A `/suggest` run instead reaches this agent
 * directly via `handleSuggestAgent`, which calls `runAgent` and emits an
 * assistant `copilotkitSuggest` tool-call message through `onMessagesChanged`
 * — writing nothing to the runner's module-level store. This keeps the test
 * off any real model SDK, so aimock does not apply here.
 */
class SuggestStubAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  /**
   * Emits a single TEXT_MESSAGE_END event so a run through the runner produces
   * at least one event and gets persisted to historicRuns (RUN_STARTED /
   * RUN_FINISHED are appended by the runner), and — when a `subscriber` is
   * supplied by the direct suggest path — surfaces the `copilotkitSuggest`
   * tool-call message via `onMessagesChanged`.
   */
  async runAgent(
    input?: RunAgentInput,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    subscriber?.onEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "msg-1",
      } as BaseEvent,
      messages: [],
      state: {},
      agent: this,
      input: input as RunAgentInput,
    });

    subscriber?.onMessagesChanged?.({
      messages: [suggestMessage],
      state: {},
      agent: this,
      input,
    });

    return { result: undefined, newMessages: [suggestMessage] };
  }

  clone(): AbstractAgent {
    return new SuggestStubAgent();
  }
}

const suggestMessage = {
  id: "suggest-assistant-1",
  role: "assistant" as const,
  toolCalls: [
    {
      id: "tc-suggest-1",
      type: "function" as const,
      function: {
        name: "copilotkitSuggest",
        arguments: JSON.stringify({
          suggestions: [{ title: "Ask about refunds", message: "Refund?" }],
        }),
      },
    },
  ],
};

const buildRunRequest = (agentId: string, threadId: string) =>
  new Request(`https://example.com/agent/${agentId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId,
      runId: `run-${threadId}`,
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });

const buildSuggestRequest = (agentId: string, threadId: string) =>
  new Request(`https://example.com/agent/${agentId}/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId,
      runId: `run-${threadId}`,
      state: {},
      messages: [{ id: "u1", role: "user", content: "hello" }],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });

/** Drains an SSE `Response` body into the list of parsed `data:` events. */
const drainSseEvents = async (
  response: Response,
): Promise<Array<{ type?: string }>> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer +=
      typeof value === "string"
        ? value
        : decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  const events: Array<{ type?: string }> = [];
  for (const frame of buffer.split("\n\n")) {
    const line = frame.trim();
    if (line.startsWith("data:")) {
      events.push(JSON.parse(line.slice("data:".length).trim()));
    }
  }
  return events;
};

const listThreadIds = async (
  runtime: CopilotRuntime,
  agentId: string,
): Promise<string[]> => {
  const response = await handleListThreads({
    runtime,
    request: new Request(`https://example.com/threads?agentId=${agentId}`),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    threads: Array<{ id: string }>;
  };
  return body.threads.map((thread) => thread.id);
};

/**
 * Core acceptance criterion, automated: a `/suggest` call must not create a
 * listed thread. The observable surface chosen is the SSE runtime's own local
 * thread-listing endpoint (`handleListThreads` → `InMemoryAgentRunner.listThreads`),
 * because that is exactly what a client / inspector reads to enumerate threads.
 * It is backed by the module-level `GLOBAL_STORE` a suggest must never touch.
 * A normal `agent/run` for a control thread first proves the listing surface
 * is live (it must show that thread), then a `/suggest` for a different id must
 * remain invisible.
 */
describe("stateless /suggest leaves no thread in the local listing", () => {
  it("lists a normal run's thread but never the suggest thread", async () => {
    const runner = new InMemoryAgentRunner();
    // Clear the module-level GLOBAL_STORE shared across InMemoryAgentRunner
    // instances so this test fully encapsulates its own thread state.
    runner.clearThreads();
    const runtime = new CopilotRuntime({
      agents: { helper: new SuggestStubAgent() },
      runner,
    });

    const unique = `${Date.now()}-${Math.random()}`;
    const runThreadId = `thread-run-${unique}`;
    const suggestThreadId = `thread-suggest-${unique}`;

    const runResponse = await handleRunAgent({
      runtime,
      request: buildRunRequest("helper", runThreadId),
      agentId: "helper",
    });
    expect(runResponse.status).toBe(200);

    // Drain the SSE stream so the underlying observable run finalizes —
    // historicRuns (and therefore listThreads) is only populated after the
    // run completes.
    const reader = runResponse.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const suggestResponse = await handleSuggestAgent({
      runtime,
      request: buildSuggestRequest("helper", suggestThreadId),
      agentId: "helper",
    });
    expect(suggestResponse.status).toBe(200);
    expect(suggestResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );

    // (a) The suggest response streams the agent's events (the client
    // reconstructs the tool-call message from them). Drain the SSE body and
    // assert the provider's event reached the stream.
    const suggestEvents = await drainSseEvents(suggestResponse);
    expect(
      suggestEvents.some((event) => event.type === "TEXT_MESSAGE_END"),
    ).toBe(true);

    const threadIds = await listThreadIds(runtime, "helper");
    // The listing surface is live: the normal run's thread shows up.
    expect(threadIds).toContain(runThreadId);
    // (b) No-leak proof: the suggest thread is NOT listed.
    expect(threadIds).not.toContain(suggestThreadId);
    // And the runner has no persisted state for the suggest thread at all.
    expect(runner.getThreadMessages(suggestThreadId)).toEqual([]);
    expect(runner.getThreadEvents(suggestThreadId)).toEqual([]);
  });
});
