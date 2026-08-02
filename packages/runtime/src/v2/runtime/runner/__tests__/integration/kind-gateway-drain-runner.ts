import { writeFile } from "node:fs/promises";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

const chunks = Number(process.env.CPKI_KIND_EVENT_CHUNKS ?? "400");
const resultPath = process.env.CPKI_KIND_RESULT_PATH;
const closeMode = process.env.CPKI_KIND_CLOSE_MODE ?? "planned";
const closeCodes: number[] = [];
const NativeWebSocket = globalThis.WebSocket;

class ObservedWebSocket extends NativeWebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
    this.addEventListener("close", (event) => closeCodes.push(event.code));
  }
}

Object.assign(globalThis, { WebSocket: ObservedWebSocket });

class SlowLifecycleAgent extends AbstractAgent {
  runCount = 0;
  emittedEvents = 0;

  async runAgent(
    input: RunAgentInput,
    subscriber?: { onEvent?: (arg: { event: BaseEvent }) => void },
  ): Promise<RunAgentResult> {
    this.runCount += 1;
    const emit = (event: BaseEvent) => {
      this.emittedEvents += 1;
      subscriber?.onEvent?.({ event });
    };
    emit({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    } as BaseEvent);
    emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "message-kind-handoff",
      role: "assistant",
    } as BaseEvent);

    for (let index = 0; index < chunks; index += 1) {
      emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-kind-handoff",
        delta: `${index},`,
      } as BaseEvent);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    emit({
      type: EventType.TEXT_MESSAGE_END,
      messageId: "message-kind-handoff",
    } as BaseEvent);
    emit({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    } as BaseEvent);
    return { result: undefined, newMessages: [] };
  }

  abortRun(): void {}
  clone(): AbstractAgent {
    return new SlowLifecycleAgent();
  }
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

async function main(): Promise<void> {
  const { IntelligenceAgentRunner } = await import("../../intelligence");
  const runner = new IntelligenceAgentRunner({
    url: process.env.CPKI_KIND_GATEWAY_URL ?? "ws://127.0.0.1:4401/runner",
    authToken: "ck_test_longsecret",
    maxReconnectMs: 500,
    maxRejoinMs: 500,
  });
  const agent = new SlowLifecycleAgent();
  const threadId = process.env.CPKI_KIND_THREAD_ID ?? "thread-kind-handoff";
  const runId = process.env.CPKI_KIND_RUN_ID ?? "run-kind-handoff";
  const input = {
    threadId,
    runId,
    messages: [],
    tools: [],
    context: [],
    state: {},
  } as RunAgentInput;

  const progressTimer = setInterval(() => {
    process.stdout.write(
      `CPKI_KIND_PROGRESS ${JSON.stringify({ closeCodes, emittedEvents: agent.emittedEvents, runCount: agent.runCount })}\n`,
    );
  }, 5_000);
  const runnerEvents = await firstValueFrom(
    runner.run({ threadId, agent, input }).pipe(toArray()),
  ).finally(() => clearInterval(progressTimer));

  await new Promise((resolve) => setTimeout(resolve, 250));
  const result = {
    closeCodes,
    runCount: agent.runCount,
    runnerErrors: runnerEvents.filter(
      (event) => event.type === EventType.RUN_ERROR,
    ).length,
    expectedEvents: chunks + 4,
  };

  if (resultPath) await writeFile(resultPath, JSON.stringify(result));
  process.stdout.write(`CPKI_KIND_RESULT ${JSON.stringify(result)}\n`);

  if (closeMode === "planned" && !closeCodes.includes(1012)) {
    throw new Error(
      `expected Phoenix service-restart close 1012, observed ${closeCodes.join(",")}`,
    );
  }
  if (closeMode === "abrupt" && !closeCodes.includes(1006)) {
    throw new Error(
      `expected abnormal close 1006, observed ${closeCodes.join(",")}`,
    );
  }
  if (agent.runCount !== 1) {
    throw new Error(`agent executed ${agent.runCount} times`);
  }
  if (result.runnerErrors !== 0) {
    throw new Error(`runner emitted ${result.runnerErrors} terminal errors`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
