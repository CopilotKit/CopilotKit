import { writeFile } from "node:fs/promises";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

const chunks = Number(process.env.CPKI_KIND_EVENT_CHUNKS ?? "400");
const resultPath = process.env.CPKI_KIND_RESULT_PATH;
const closeMode = process.env.CPKI_KIND_CLOSE_MODE ?? "planned";
const closeCodes: number[] = [];
let interruptTransport: (() => void) | undefined;
const NativeWebSocket = globalThis.WebSocket;

class ObservedWebSocket extends NativeWebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
    interruptTransport = () => this.close(1000, "test transport interruption");
    this.addEventListener("open", () =>
      process.stdout.write("CPKI_KIND_SOCKET open\n"),
    );
    this.addEventListener("error", () =>
      process.stderr.write("CPKI_KIND_SOCKET error\n"),
    );
    this.addEventListener("close", (event) => closeCodes.push(event.code));
  }
}

Object.assign(globalThis, { WebSocket: ObservedWebSocket });

class SlowLifecycleAgent extends AbstractAgent {
  runCount = 0;
  emittedEvents = 0;
  aborted = false;

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
      if (closeMode === "transport" && index === 20) {
        // Close only the transport. The gateway and agent remain alive.
        interruptTransport?.();
      }
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

  abortRun(): void {
    this.aborted = true;
  }
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
  const gatewayUrl =
    process.env.CPKI_KIND_GATEWAY_URL ?? "ws://127.0.0.1:4401/runner";
  const healthUrl = new URL("/health/ready", gatewayUrl.replace(/^ws/, "http"));
  // Pod readiness can precede service routing in a fresh Kind cluster. Keep
  // setup separate from the runner interruption under test.
  let reachable = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const health = await fetch(healthUrl, {
        signal: AbortSignal.timeout(3_000),
      });
      await health.arrayBuffer();
      if (health.ok) {
        reachable = true;
        break;
      }
    } catch {
      process.stdout.write(`CPKI_KIND_WAIT_GATEWAY ${attempt + 1}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!reachable)
    throw new Error("gateway was not reachable before the runner test");
  const runner = new IntelligenceAgentRunner({
    url: gatewayUrl,
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
    agentAborted: agent.aborted,
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
  if (closeMode === "transport" && !closeCodes.includes(1000)) {
    throw new Error(
      `expected transport close 1000, observed ${closeCodes.join(",")}`,
    );
  }
  if (agent.runCount !== 1) {
    throw new Error(`agent executed ${agent.runCount} times`);
  }
  if (result.runnerErrors !== 0) {
    throw new Error(`runner emitted ${result.runnerErrors} terminal errors`);
  }
  if (result.agentAborted) {
    throw new Error(
      "runner aborted the accepted agent during gateway recovery",
    );
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
