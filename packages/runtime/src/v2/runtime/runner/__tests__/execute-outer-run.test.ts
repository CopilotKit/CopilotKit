import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAgentRunner } from "../in-memory";
import type {
  BaseEvent,
  RunAgentInput,
  RunAgentResult,
  RunStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

const makeInput = (threadId: string, runId: string): RunAgentInput => ({
  threadId,
  runId,
  messages: [],
  state: {},
  tools: [],
  context: [],
});

/**
 * Emits its OWN RUN_STARTED + a single text message + its OWN RUN_FINISHED,
 * then resolves. `execute` must suppress this inner agent's RUN_STARTED /
 * RUN_FINISHED lifecycle and only surface the text message content.
 */
class ReplyAgent extends AbstractAgent {
  constructor(
    private readonly messageId: string,
    private readonly text: string,
  ) {
    super();
  }

  async runAgent(
    input: RunAgentInput,
    options: {
      onEvent: (e: { event: BaseEvent }) => void;
      onRunStartedEvent?: () => void;
    },
  ): Promise<RunAgentResult> {
    options.onEvent({
      event: {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as RunStartedEvent,
    });
    options.onRunStartedEvent?.();
    options.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId: this.messageId,
        role: "assistant",
      } as TextMessageStartEvent,
    });
    options.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: this.messageId,
        delta: this.text,
      } as TextMessageContentEvent,
    });
    options.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_END,
        messageId: this.messageId,
      } as TextMessageEndEvent,
    });
    options.onEvent({
      event: {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    });
    return { result: undefined, newMessages: [] };
  }

  clone(): AbstractAgent {
    return new ReplyAgent(this.messageId, this.text);
  }

  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

class InnerErrorAgent extends AbstractAgent {
  async runAgent(
    input: RunAgentInput,
    options: {
      onEvent: (e: { event: BaseEvent }) => void;
      onRunStartedEvent?: () => void;
    },
  ): Promise<RunAgentResult> {
    options.onEvent({
      event: {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as RunStartedEvent,
    });
    options.onRunStartedEvent?.();
    options.onEvent({
      event: {
        type: EventType.RUN_ERROR,
        message: "inner boom",
        code: "INNER",
      } as BaseEvent,
    });
    return { result: undefined, newMessages: [] };
  }

  clone(): AbstractAgent {
    return new InnerErrorAgent();
  }

  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

describe("AgentRunner.execute — outer run wrapping multiple inner agent calls", () => {
  let runner: InMemoryAgentRunner;

  beforeEach(() => {
    runner = new InMemoryAgentRunner();
    runner.clearThreads();
  });

  it("emits exactly one RUN_STARTED and one terminal across two inner runs, suppressing inner lifecycle", async () => {
    const threadId = "execute-two-inner";
    const events = await firstValueFrom(
      runner
        .execute({
          threadId,
          runId: "outer-1",
          input: makeInput(threadId, "outer-1"),
          turn: async (controller) => {
            await controller.runAgent({
              agent: new ReplyAgent("m1", "one"),
              input: makeInput(threadId, "inner-1"),
            });
            await controller.runAgent({
              agent: new ReplyAgent("m2", "two"),
              input: makeInput(threadId, "inner-2"),
            });
          },
        })
        .pipe(toArray()),
    );

    const types = events.map((e) => e.type);
    // Exactly one outer RUN_STARTED, and it is first.
    expect(types.filter((t) => t === EventType.RUN_STARTED)).toHaveLength(1);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    // Exactly one terminal, and it is last and is RUN_FINISHED (success).
    const terminals = types.filter(
      (t) => t === EventType.RUN_FINISHED || t === EventType.RUN_ERROR,
    );
    expect(terminals).toEqual([EventType.RUN_FINISHED]);
    expect(types.at(-1)).toBe(EventType.RUN_FINISHED);
    // Both inner replies' content survived, in order.
    const contents = events
      .filter(
        (e): e is TextMessageContentEvent =>
          e.type === EventType.TEXT_MESSAGE_CONTENT,
      )
      .map((e) => e.delta);
    expect(contents).toEqual(["one", "two"]);
  });

  it("carries the outer runId on the synthesized RUN_STARTED", async () => {
    const threadId = "execute-outer-runid";
    const events = await firstValueFrom(
      runner
        .execute({
          threadId,
          runId: "outer-42",
          input: makeInput(threadId, "outer-42"),
          turn: async (controller) => {
            await controller.runAgent({
              agent: new ReplyAgent("m1", "hi"),
              input: makeInput(threadId, "inner-1"),
            });
          },
        })
        .pipe(toArray()),
    );

    const runStarted = events.find(
      (e): e is RunStartedEvent => e.type === EventType.RUN_STARTED,
    );
    expect(runStarted?.runId).toBe("outer-42");
  });

  it("treats an inner RUN_ERROR as outer failure: terminal is RUN_ERROR, never RUN_FINISHED", async () => {
    const threadId = "execute-inner-error";
    const events = await firstValueFrom(
      runner
        .execute({
          threadId,
          runId: "outer-err",
          input: makeInput(threadId, "outer-err"),
          turn: async (controller) => {
            await controller.runAgent({
              agent: new InnerErrorAgent(),
              input: makeInput(threadId, "inner-1"),
            });
          },
        })
        .pipe(toArray()),
    );

    const types = events.map((e) => e.type);
    expect(types.at(-1)).toBe(EventType.RUN_ERROR);
    expect(types.filter((t) => t === EventType.RUN_FINISHED)).toHaveLength(0);
  });
});
