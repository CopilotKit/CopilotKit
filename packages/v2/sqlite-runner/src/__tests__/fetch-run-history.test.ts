import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteAgentRunner } from "..";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
} from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import fs from "fs";
import os from "os";
import path from "path";

// Types for external run history
interface RunHistory {
  runId: string;
  messages: Message[];
}

interface FetchRunHistoryOptions {
  threadId: string;
}

interface FetchRunHistoryResult {
  runs: RunHistory[];
}

type RunCallbacks = {
  onEvent: (event: { event: BaseEvent }) => void | Promise<void>;
  onNewMessage?: (args: { message: Message }) => void | Promise<void>;
  onRunStartedEvent?: () => void | Promise<void>;
};

class MockAgent extends AbstractAgent {
  private externalRuns: RunHistory[] = [];
  public fetchRunHistoryCallCount = 0;

  constructor(private readonly events: BaseEvent[] = []) {
    super();
  }

  setExternalRuns(runs: RunHistory[]) {
    this.externalRuns = runs;
  }

  async fetchRunHistory(
    _options: FetchRunHistoryOptions,
  ): Promise<FetchRunHistoryResult | undefined> {
    this.fetchRunHistoryCallCount += 1;
    return { runs: this.externalRuns };
  }

  async runAgent(input: RunAgentInput, callbacks: RunCallbacks): Promise<void> {
    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    await callbacks.onEvent({ event: runStarted });
    await callbacks.onRunStartedEvent?.();

    for (const event of this.events) {
      await callbacks.onEvent({ event });
    }

    const runFinished: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    };
    await callbacks.onEvent({ event: runFinished });
  }

  abortRun(): void {}

  clone(): AbstractAgent {
    const cloned = new MockAgent(this.events);
    cloned.setExternalRuns(this.externalRuns);
    return cloned;
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

// Agent without fetchRunHistory implementation
class MockAgentWithoutFetchRunHistory extends AbstractAgent {
  constructor(private readonly events: BaseEvent[] = []) {
    super();
  }

  async runAgent(input: RunAgentInput, callbacks: RunCallbacks): Promise<void> {
    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    await callbacks.onEvent({ event: runStarted });
    await callbacks.onRunStartedEvent?.();

    for (const event of this.events) {
      await callbacks.onEvent({ event });
    }

    const runFinished: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    };
    await callbacks.onEvent({ event: runFinished });
  }

  abortRun(): void {}

  clone(): AbstractAgent {
    return new MockAgentWithoutFetchRunHistory(this.events);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

describe("SqliteAgentRunner fetchRunHistory", () => {
  let runner: SqliteAgentRunner;
  let dbPath: string;

  beforeEach(() => {
    // Create a temporary database file for testing
    dbPath = path.join(os.tmpdir(), `test-${Date.now()}.db`);
    runner = new SqliteAgentRunner({ dbPath });
  });

  afterEach(() => {
    runner.close();
    // Clean up the database file
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe("importExternalRuns via run()", () => {
    it("imports external runs with user messages", async () => {
      const threadId = "ext-user-msg";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [{ id: "msg-1", role: "user", content: "Hello" } as Message],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      // Connect to get all historic events
      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      // Should have events from external run + local run
      const textStarts = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      );
      expect(textStarts).toHaveLength(1);
      expect((textStarts[0] as any).messageId).toBe("msg-1");
      expect((textStarts[0] as any).role).toBe("user");
    });

    it("imports external runs with assistant messages", async () => {
      const threadId = "ext-assistant-msg";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            { id: "msg-1", role: "assistant", content: "Hi there!" } as Message,
          ],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      const textStarts = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      );
      expect(textStarts).toHaveLength(1);
      expect((textStarts[0] as any).role).toBe("assistant");
    });

    it("imports external runs with tool calls", async () => {
      const threadId = "ext-tool-call";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            {
              id: "msg-1",
              role: "assistant",
              toolCalls: [
                {
                  id: "tool-1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"NYC"}' },
                },
              ],
            } as Message,
          ],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      const toolStarts = events.filter(
        (e) => e.type === EventType.TOOL_CALL_START,
      );
      expect(toolStarts).toHaveLength(1);
      expect((toolStarts[0] as any).toolCallId).toBe("tool-1");
      expect((toolStarts[0] as any).toolCallName).toBe("get_weather");
    });

    it("imports external runs with tool results", async () => {
      const threadId = "ext-tool-result";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            {
              id: "msg-1",
              role: "tool",
              content: "Sunny, 72F",
              toolCallId: "tool-1",
            } as Message,
          ],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      const toolResults = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0] as any).toolCallId).toBe("tool-1");
      expect((toolResults[0] as any).content).toBe("Sunny, 72F");
    });

    it("deduplicates existing runs", async () => {
      const threadId = "ext-dedup-runs";

      // First run
      const agent1 = new MockAgent([]);
      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent1,
            input: {
              threadId,
              runId: "existing-run",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      // Second run with external runs including the existing run
      const externalRuns: RunHistory[] = [
        {
          runId: "existing-run", // Should be filtered out
          messages: [{ id: "msg-1", role: "user", content: "Old" } as Message],
        },
        {
          runId: "new-run",
          messages: [{ id: "msg-2", role: "user", content: "New" } as Message],
        },
      ];

      const agent2 = new MockAgent([]);
      agent2.setExternalRuns(externalRuns);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent2,
            input: {
              threadId,
              runId: "local-run-2",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      // Should have events from new-run but not the duplicate
      const runStarts = events.filter((e) => e.type === EventType.RUN_STARTED);
      // 3 runs: existing-run, new-run (imported), local-run-2
      expect(runStarts).toHaveLength(3);

      // Only msg-2 from new-run should be present (existing-run was filtered)
      const textStarts = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      );
      expect(textStarts).toHaveLength(1);
      expect((textStarts[0] as any).messageId).toBe("msg-2");
    });

    it("deduplicates existing messages within runs", async () => {
      const threadId = "ext-dedup-msgs";

      // First run with external messages
      const externalRuns1: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            { id: "msg-1", role: "user", content: "First" } as Message,
          ],
        },
      ];

      const agent1 = new MockAgent([]);
      agent1.setExternalRuns(externalRuns1);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent1,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      // Second run with external runs containing duplicate message
      const externalRuns2: RunHistory[] = [
        {
          runId: "external-run-2",
          messages: [
            { id: "msg-1", role: "user", content: "First" } as Message, // Duplicate
            { id: "msg-2", role: "user", content: "Second" } as Message, // New
          ],
        },
      ];

      const agent2 = new MockAgent([]);
      agent2.setExternalRuns(externalRuns2);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent2,
            input: {
              threadId,
              runId: "local-run-2",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      // Should have msg-1 from first import and msg-2 from second
      const textContents = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
      );
      expect(textContents).toHaveLength(2);
    });

    it("skips runs with no messages after filtering", async () => {
      const threadId = "ext-skip-empty";

      // First run with external messages
      const externalRuns1: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            { id: "msg-1", role: "user", content: "First" } as Message,
          ],
        },
      ];

      const agent1 = new MockAgent([]);
      agent1.setExternalRuns(externalRuns1);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent1,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      // Second run with external runs where all messages are duplicates
      const externalRuns2: RunHistory[] = [
        {
          runId: "external-run-2",
          messages: [
            { id: "msg-1", role: "user", content: "First" } as Message, // All duplicates
          ],
        },
      ];

      const agent2 = new MockAgent([]);
      agent2.setExternalRuns(externalRuns2);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent2,
            input: {
              threadId,
              runId: "local-run-2",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      // external-run-2 should not be stored (empty after filtering)
      const runStarts = events.filter((e) => e.type === EventType.RUN_STARTED);
      const runIds = runStarts.map((e) => (e as any).runId);
      expect(runIds).not.toContain("external-run-2");
    });

    it("stores imported runs with null parentRunId", async () => {
      const threadId = "ext-no-parent-chain";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [{ id: "msg-1", role: "user", content: "First" } as Message],
        },
        {
          runId: "external-run-2",
          messages: [
            { id: "msg-2", role: "user", content: "Second" } as Message,
          ],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "local-run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const connectAgent = new MockAgent([]);
      const events = await firstValueFrom(
        runner.connect({ threadId, agent: connectAgent }).pipe(toArray()),
      );

      // External runs should both be present (no parent chaining means they're roots)
      const runStarts = events.filter((e) => e.type === EventType.RUN_STARTED);
      expect(runStarts).toHaveLength(3); // 2 external + 1 local
    });
  });

  describe("importExternalRuns via connect()", () => {
    it("imports external runs on connect when idle", async () => {
      const threadId = "connect-import";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            { id: "msg-1", role: "user", content: "Hello" } as Message,
          ],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      // Connect should trigger import
      const events = await firstValueFrom(
        runner.connect({ threadId, agent }).pipe(toArray()),
      );

      // Should have events from the imported run
      expect(events.length).toBeGreaterThan(0);
      const runStarts = events.filter((e) => e.type === EventType.RUN_STARTED);
      expect(runStarts).toHaveLength(1);
      expect((runStarts[0] as any).runId).toBe("external-run-1");
    });

    it("returns imported run events on connect", async () => {
      const threadId = "connect-events";
      const externalRuns: RunHistory[] = [
        {
          runId: "external-run-1",
          messages: [
            { id: "msg-1", role: "user", content: "Hello" } as Message,
            { id: "msg-2", role: "assistant", content: "Hi!" } as Message,
          ],
        },
      ];

      const agent = new MockAgent([]);
      agent.setExternalRuns(externalRuns);

      const events = await firstValueFrom(
        runner.connect({ threadId, agent }).pipe(toArray()),
      );

      // Should have all events from the imported run
      const runStarted = events.find((e) => e.type === EventType.RUN_STARTED);
      const runFinished = events.find((e) => e.type === EventType.RUN_FINISHED);
      const textStarts = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      );

      expect(runStarted).toBeDefined();
      expect(runFinished).toBeDefined();
      expect(textStarts).toHaveLength(2); // user + assistant
    });
  });

  describe("combines external and agent messages", () => {
    it("combines external messages with new agent messages on reconnect", async () => {
      const threadId = "ext-plus-agent";

      // Step 1: Agent with external messages id-1 and id-2
      const agent1 = new MockAgent([]);
      agent1.setExternalRuns([
        {
          runId: "external-run-1",
          messages: [
            { id: "id-1", role: "user", content: "First external" } as Message,
            { id: "id-2", role: "assistant", content: "Second external" } as Message,
          ],
        },
      ]);

      // Step 2: Connect to import external messages
      await firstValueFrom(runner.connect({ threadId, agent: agent1 }).pipe(toArray()));

      // Verify external messages were imported
      const afterImport = await firstValueFrom(
        runner.connect({ threadId, agent: new MockAgent([]) }).pipe(toArray()),
      );
      const importedTextStarts = afterImport.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      );
      expect(importedTextStarts).toHaveLength(2);

      // Step 3: Run agent that emits id-3
      const agentEvents: BaseEvent[] = [
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "id-3",
          role: "assistant",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "id-3",
          delta: "New agent message",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "id-3",
        } as BaseEvent,
      ];
      const agent2 = new MockAgent(agentEvents);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: agent2,
            input: { threadId, runId: "agent-run-1", messages: [], tools: [], context: [] },
          })
          .pipe(toArray()),
      );

      // Step 4: Connect again - should get all messages (id-1, id-2, id-3)
      // Use agent with no external runs since we already imported those
      const agent3 = new MockAgent([]);

      const reconnectEvents = await firstValueFrom(
        runner.connect({ threadId, agent: agent3 }).pipe(toArray()),
      );

      // Find all TEXT_MESSAGE_START events to verify message IDs
      const textMessageStarts = reconnectEvents.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      );
      const messageIds = textMessageStarts.map((e) => (e as any).messageId);

      expect(messageIds).toContain("id-1");
      expect(messageIds).toContain("id-2");
      expect(messageIds).toContain("id-3");
      expect(textMessageStarts).toHaveLength(3);
    });
  });

  describe("agent without fetchRunHistory", () => {
    it("works when agent does not implement fetchRunHistory", async () => {
      const threadId = "no-fetch";
      const agent = new MockAgentWithoutFetchRunHistory([]);

      // Should work without errors
      const events = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "run-1",
              messages: [],
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe(EventType.RUN_STARTED);
    });
  });
});
