import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentInThread, ThreadRunError } from "../index";
import type { RunAgentInThreadOptions } from "../index";
import {
  CopilotKitIntelligence,
  PlatformRequestError,
} from "../intelligence-platform/client";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { startFakeLockGateway } from "./helpers/fake-lock-gateway";
import type {
  FakeLockGatewayOptions,
  StoredMessage,
} from "./helpers/fake-lock-gateway";

/**
 * A run with no browser attached (a scheduled run, a hand-off from another
 * agent, a resume once a person answers) goes through `runAgentInThread`.
 *
 * The real Intelligence client, runner and Phoenix client run against a fake
 * Intelligence on 127.0.0.1 that keeps threads, their messages and their
 * locks as app-api does, and checks every batch of runner events against the
 * lock as the gateway does. Nothing in the runtime is replaced.
 */

const threadId = "550e8400-e29b-41d4-a716-446655440077";
const runId = "run-unattended-1";
const userId = "user-1";

/** What the next agent does with the input it is given. */
type Script = (
  input: RunAgentInput,
  emit: (event: BaseEvent) => void,
) => "finish" | "end" | "wait";

class ScriptedAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor(private readonly script: Script) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    return new Observable<BaseEvent>((subscriber) => {
      const emit = (event: BaseEvent) => subscriber.next(event);
      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      const outcome = this.script(input, emit);
      if (outcome === "finish") {
        emit({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent);
        subscriber.complete();
      } else if (outcome === "end") {
        subscriber.complete();
      }
    });
  }
}

/** The agent says `text` in one assistant message. */
function says(text: string, messageId = "reply-1"): Script {
  return (_input, emit) => {
    emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    } as BaseEvent);
    for (const delta of text.match(/.{1,8}/g) ?? []) {
      emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta,
      } as BaseEvent);
    }
    emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    return "finish";
  };
}

/** The agent starts writing and keeps going until it is stopped. */
const keepsWorking: Script = (_input, emit) => {
  emit({
    type: EventType.TEXT_MESSAGE_START,
    messageId: "reply-1",
    role: "assistant",
  } as BaseEvent);
  emit({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: "reply-1",
    delta: "Working on it",
  } as BaseEvent);
  return "wait";
};

const ask = (id: string, content: string): Message => ({
  id,
  role: "user",
  content,
});

let fake: Awaited<ReturnType<typeof startFakeLockGateway>>;
const previousTelemetrySetting = process.env.COPILOTKIT_TELEMETRY_DISABLED;
const needsWebSocket = typeof globalThis.WebSocket === "undefined";

beforeEach(() => {
  process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
  // Node 20 has no global WebSocket; Node 22+ uses its native one.
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
});

afterEach(async () => {
  await fake?.close();
  if (needsWebSocket) vi.unstubAllGlobals();
  if (previousTelemetrySetting === undefined) {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  } else {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = previousTelemetrySetting;
  }
});

/** A fake Intelligence, and the runtime pieces an app already has. */
async function platform(
  options: FakeLockGatewayOptions = {},
  lock: { lockTtlSeconds?: number; lockHeartbeatIntervalSeconds?: number } = {},
) {
  fake = await startFakeLockGateway({ threads: {}, ...options });
  const intelligence = new CopilotKitIntelligence({
    apiKey: "cpk-42_short_long",
    apiUrl: fake.apiUrl,
    wsUrl: fake.wsUrl,
  });
  const runner = new IntelligenceAgentRunner({
    url: intelligence.ɵgetRunnerWsUrl(),
    authToken: intelligence.ɵgetRunnerAuthToken(),
  });
  return { intelligence, runner, ...lock };
}

function run(
  runtime: RunAgentInThreadOptions["runtime"],
  agent: AbstractAgent,
  options: Partial<RunAgentInThreadOptions> = {},
) {
  return runAgentInThread({
    runtime,
    agent,
    agentId: "test",
    threadId,
    userId,
    runId,
    ...options,
  });
}

const storedRunStarted = () =>
  fake.stored.find((event) => event.type === EventType.RUN_STARTED) as
    | (BaseEvent & { input: RunAgentInput })
    | undefined;
const storedTypes = () => fake.stored.map((event) => event.type);
const position = (entry: string | RegExp) =>
  fake.timeline.findIndex((line) =>
    typeof entry === "string" ? line === entry : entry.test(line),
  );

describe("a run with no browser attached", () => {
  it("creates the Thread, stores the run in it under the lock, and frees the Thread", async () => {
    const runtime = await platform();
    const agent = new ScriptedAgent(says("Here is today's summary."));

    const result = await run(runtime, agent, {
      messages: [ask("ask-1", "Summarise today")],
    });

    expect(result).toEqual({
      threadId,
      runId,
      stopped: false,
      newMessages: [
        {
          id: "reply-1",
          role: "assistant",
          content: "Here is today's summary.",
        },
      ],
    });
    expect(storedTypes().at(-1)).toBe(EventType.RUN_FINISHED);
    expect(fake.timeline.filter((line) => line.startsWith("stored "))).toEqual(
      expect.arrayContaining([expect.stringMatching(/\(lock held\)$/)]),
    );
    expect(fake.timeline.filter((line) => line.startsWith("refused "))).toEqual(
      [],
    );
    expect(position("thread created")).toBeLessThan(position("lock acquired"));
    expect(position("lock acquired")).toBeLessThan(position("runner joined"));
    expect(position("gateway released the lock")).toBeLessThan(
      position(/^runtime release/),
    );
    expect(fake.lockOwner(threadId)).toBeUndefined();
  });

  it("runs with only an Intelligence client, through one runner it keeps for that client", async () => {
    const { intelligence } = await platform();

    const first = await run(
      { intelligence },
      new ScriptedAgent(says("First.", "reply-a")),
      { messages: [ask("ask-a", "One")] },
    );
    const second = await run(
      { intelligence },
      new ScriptedAgent(says("Second.", "reply-b")),
      { runId: "run-unattended-2", messages: [ask("ask-b", "Two")] },
    );

    expect(first.newMessages.map((message) => message.content)).toEqual([
      "First.",
    ]);
    expect(second.newMessages.map((message) => message.content)).toEqual([
      "Second.",
    ]);
    expect(
      storedTypes().filter((type) => type === EventType.RUN_FINISHED),
    ).toHaveLength(2);
    expect(fake.lockOwner(threadId)).toBeUndefined();
  });

  it("shows the agent the Thread's history and stores only this run's new message", async () => {
    const history: StoredMessage[] = [
      { id: "earlier-ask", role: "user", content: "What is on today?" },
      { id: "earlier-reply", role: "assistant", content: "Two meetings." },
    ];
    const runtime = await platform({ threads: { [threadId]: history } });
    const agent = new ScriptedAgent(says("Still two meetings."));

    await run(runtime, agent, {
      messages: [ask("ask-2", "Anything new?")],
    });

    expect(agent.inputs[0]?.messages.map((message) => message.id)).toEqual([
      "earlier-ask",
      "earlier-reply",
      "ask-2",
    ]);
    expect(storedRunStarted()?.input.messages).toEqual([
      ask("ask-2", "Anything new?"),
    ]);
    expect(fake.timeline).not.toContain("thread created");
  });

  it("lets the caller build the conversation from the history, and never stores a message twice", async () => {
    const history: StoredMessage[] = [
      { id: "earlier-ask", role: "user", content: "What is on today?" },
      { id: "earlier-reply", role: "assistant", content: "Two meetings." },
    ];
    const runtime = await platform({ threads: { [threadId]: history } });
    const agent = new ScriptedAgent(says("Done."));
    let seen: Message[] = [];

    await run(runtime, agent, {
      messages: (stored) => {
        seen = stored;
        return [
          ...stored.slice(-1),
          { ...stored[0], content: "edited, not stored again" } as Message,
          ask("ask-3", "Go on"),
        ];
      },
    });

    expect(seen.map((message) => message.id)).toEqual([
      "earlier-ask",
      "earlier-reply",
    ]);
    expect(agent.inputs[0]?.messages.map((message) => message.id)).toEqual([
      "earlier-reply",
      "earlier-ask",
      "ask-3",
    ]);
    expect(storedRunStarted()?.input.messages).toEqual([ask("ask-3", "Go on")]);
  });

  it("sends the agent a brief while the Thread records a short request", async () => {
    const runtime = await platform();
    const agent = new ScriptedAgent(says("Here is what I found."));

    await run(runtime, agent, {
      messages: (_history, issued) => [
        ask(
          `brief-${issued.runId}`,
          "Earlier: a long conversation. Now: find it.",
        ),
      ],
      persistedInputMessages: (issued) => [
        ask(`brief-${issued.runId}`, "Asked to find it"),
      ],
    });

    expect(agent.inputs[0]?.messages).toEqual([
      ask(`brief-${runId}`, "Earlier: a long conversation. Now: find it."),
    ]);
    expect(storedRunStarted()?.input.messages).toEqual([
      ask(`brief-${runId}`, "Asked to find it"),
    ]);
  });

  it("passes the run's options through to the agent and the lock", async () => {
    const runtime = await platform();
    const agent = new ScriptedAgent(says("Sure."));
    const deltas: string[] = [];

    await run(runtime, agent, {
      messages: [ask("ask-4", "Check the inbox")],
      tools: [
        { name: "read_inbox", description: "Reads mail", parameters: {} },
      ],
      context: [{ description: "Time zone", value: "Europe/London" }],
      forwardedProps: { source: "schedule" },
      learningContainerId: "team-ops",
      analyticsContext: { trigger: "schedule" },
      requestId: "request-1",
      subscriber: {
        onTextMessageContentEvent: ({ event }) => {
          deltas.push(event.delta);
        },
      },
    });

    expect(agent.inputs[0]).toMatchObject({
      threadId,
      runId,
      tools: [{ name: "read_inbox" }],
      context: [{ description: "Time zone", value: "Europe/London" }],
      forwardedProps: { source: "schedule" },
    });
    expect(deltas.join("")).toBe("Sure.");
    const created = fake.requests.find(
      (request) => request.method === "POST" && request.path === "/api/threads",
    );
    expect(created?.body).toMatchObject({
      threadId,
      userId,
      agentId: "test",
      learningContainerId: "team-ops",
    });
    const locked = fake.requests.find(
      (request) => request.method === "POST" && request.path.endsWith("/lock"),
    );
    expect(locked?.body).toMatchObject({
      runId,
      userId,
      agentId: "test",
      learningContainerId: "team-ops",
      analyticsContext: { trigger: "schedule" },
      requestId: "request-1",
    });
  });
});

describe("a run that cannot go ahead", () => {
  it("is refused before anything runs when another run holds the Thread", async () => {
    const runtime = await platform({ threads: { [threadId]: [] } });
    fake.takeLock(threadId, "browser-run");
    const agent = new ScriptedAgent(says("never said"));

    const refusal = await run(runtime, agent).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(PlatformRequestError);
    expect((refusal as PlatformRequestError).status).toBe(409);
    expect(agent.inputs).toEqual([]);
    expect(fake.timeline).not.toContain("runner joined");
    expect(fake.lockOwner(threadId)).toBe("browser-run");
  });

  it("sends nothing when its signal has already aborted", async () => {
    const runtime = await platform();
    const reason = new Error("cancelled before it started");

    await expect(
      run(runtime, new ScriptedAgent(says("never said")), {
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(fake.requests).toEqual([]);
  });
});

describe("a run that does not finish", () => {
  it("fails with the agent's error and still frees the Thread", async () => {
    const runtime = await platform();
    const agent = new ScriptedAgent((_input, emit) => {
      emit({
        type: EventType.RUN_ERROR,
        message: "The model call failed",
        code: "MODEL_CALL_FAILED",
      } as BaseEvent);
      return "end";
    });

    const failure = await run(runtime, agent).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ThreadRunError);
    expect(failure).toMatchObject({
      reason: "run_failed",
      message: "The model call failed",
      code: "MODEL_CALL_FAILED",
      threadId,
      runId,
    });
    expect(storedTypes().at(-1)).toBe(EventType.RUN_ERROR);
    expect(fake.lockOwner(threadId)).toBeUndefined();
  });

  it("is stopped by its signal, with the stop recorded before the run's last event", async () => {
    const runtime = await platform();
    const agent = new ScriptedAgent(keepsWorking);
    const controller = new AbortController();

    const running = run(runtime, agent, { signal: controller.signal });
    await vi.waitFor(() =>
      expect(storedTypes()).toContain(EventType.TEXT_MESSAGE_CONTENT),
    );
    controller.abort();
    const result = await running;

    expect(result.stopped).toBe(true);
    expect(result.newMessages).toEqual([
      { id: "reply-1", role: "assistant", content: "Working on it" },
    ]);
    const recorded = position(`stop recorded for ${runId}`);
    expect(recorded).toBeGreaterThan(-1);
    expect(recorded).toBeLessThan(
      position(new RegExp(`^stored .*${EventType.RUN_FINISHED}`)),
    );
    expect(fake.lockOwner(threadId)).toBeUndefined();
  });

  it("is stopped when its lock is lost, records no stop, and leaves the Thread to the run that took it", async () => {
    const runtime = await platform(
      {},
      { lockTtlSeconds: 120, lockHeartbeatIntervalSeconds: 0.05 },
    );
    const agent = new ScriptedAgent(keepsWorking);

    const running = run(runtime, agent).catch((error: unknown) => error);
    await vi.waitFor(() =>
      expect(storedTypes()).toContain(EventType.TEXT_MESSAGE_CONTENT),
    );
    fake.takeLock(threadId, "browser-run");
    const failure = await running;

    expect(failure).toBeInstanceOf(ThreadRunError);
    expect(failure).toMatchObject({ reason: "lock_lost", threadId, runId });
    expect((failure as ThreadRunError).cause).toBeInstanceOf(
      PlatformRequestError,
    );
    expect(position(/^stop recorded/)).toBe(-1);
    expect(fake.lockOwner(threadId)).toBe("browser-run");
  });

  it("gives up waiting after stopTimeoutMs and frees the Thread when Intelligence stops answering", async () => {
    // The gateway takes far longer to store a batch than the caller waits.
    const runtime = await platform({ storeDelayMs: 30_000 });
    const agent = new ScriptedAgent(keepsWorking);
    const controller = new AbortController();

    const running = run(runtime, agent, {
      signal: controller.signal,
      stopTimeoutMs: 200,
    }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fake.timeline).toContain("runner joined"));
    await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
    const stoppedAt = Date.now();
    controller.abort();
    const failure = await running;

    expect(failure).toBeInstanceOf(ThreadRunError);
    expect(failure).toMatchObject({ reason: "stop_timeout", threadId, runId });
    expect(Date.now() - stoppedAt).toBeLessThan(5_000);
    expect(fake.lockOwner(threadId)).toBeUndefined();
  });
});
