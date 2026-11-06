/**
 * The smallest real deployment: a CopilotRuntime with one agent, behind the
 * fetch handler, built at module scope the way users write it. The same
 * module is bundled for Cloudflare Workers (by wrangler) and for the Vercel
 * Edge runtime (by run.mjs).
 */
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { Observable } from "rxjs";

/** Replies with the last user message, so no model or network is needed. */
class EchoAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const { threadId, runId } = input;
      const last = input.messages.at(-1);
      const text =
        last && typeof last.content === "string" ? last.content : "(empty)";
      const messageId = `echo-${runId}`;
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId,
        runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: `echo: ${text}`,
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }
}

// The runtime and handler are built at module scope, where Workers forbid
// random values, timers and I/O. The agent is built per request for now:
// @ag-ui/client <= 1.0.3 generates a UUID in the AbstractAgent constructor.
// ag-ui main defers it (ag-ui 9fe03bce); once a release with that ships and
// the runtime depends on it, use `agents: { default: new EchoAgent() }`.
const runtime = new CopilotRuntime({
  agents: () => ({ default: new EchoAgent() }),
});
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default {
  fetch(request: Request): Promise<Response> {
    return handler(request);
  },
};
