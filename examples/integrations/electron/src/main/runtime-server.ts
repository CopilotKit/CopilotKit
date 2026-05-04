import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

/**
 * Stub agent that echoes the last user message as a single text-message event
 * stream. Replace with a real agent (LangGraphAgent, OpenAIAgent, etc.) once
 * you have keys/services configured.
 */
class EchoAgent extends AbstractAgent {
  clone() {
    return new EchoAgent();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const messageId = `msg_${Date.now()}`;
      const last = [...input.messages].reverse().find((m) => m.role === "user");
      const reply = last?.content
        ? `You said: ${last.content}`
        : "Send a message and I'll echo it back.";

      observer.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      observer.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent);
      observer.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: reply,
      } as BaseEvent);
      observer.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      } as BaseEvent);
      observer.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      observer.complete();
    });
  }
}

export interface RuntimeServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startRuntimeServer(): Promise<RuntimeServerHandle> {
  const runtime = new CopilotRuntime({
    agents: { default: new EchoAgent() },
    runner: new InMemoryAgentRunner(),
  });

  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  });

  const server = createServer(listener);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/copilotkit`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
