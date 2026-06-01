import { randomUUID } from "node:crypto";
import {
  EventType,
  type BaseEvent,
  type Message,
  type MessagesSnapshotEvent,
  type ToolCall,
  type ToolCallResultEvent,
} from "@ag-ui/client";
import { InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { concatMap, Observable, of } from "rxjs";

/**
 * AgentCore stores conversation history server-side via AgentCoreMemorySaver /
 * AgentCoreMemorySessionManager. When CopilotKit reconnects to an existing
 * thread (e.g. page refresh), two issues arise that this runner fixes:
 *
 * 1. Unknown threads — CopilotKit may call `connect()` for a thread that has
 *    never had a `run()` (first load). The base runner would error; we emit an
 *    empty snapshot instead so the UI initialises cleanly.
 * 2. Missing tool-call results — AgentCore's replayed history contains assistant
 *    messages with tool calls but no corresponding TOOL_CALL_RESULT events.
 *    CopilotKit needs those to reconcile its message state, so we synthesise
 *    empty results for each past tool call before the snapshot.
 */
export class AgentCoreRunner extends InMemoryAgentRunner {
  private readonly knownThreadIds = new Set<string>();

  override run(request: Parameters<InMemoryAgentRunner["run"]>[0]) {
    if (request.threadId) this.knownThreadIds.add(request.threadId);
    return super.run(request);
  }

  override connect(request: Parameters<InMemoryAgentRunner["connect"]>[0]) {
    if (!request.threadId || !this.knownThreadIds.has(request.threadId)) {
      const threadId = request.threadId ?? randomUUID();
      const runId = randomUUID();
      return of(
        { type: EventType.RUN_STARTED, threadId, runId },
        { type: EventType.MESSAGES_SNAPSHOT, messages: [] },
        { type: EventType.RUN_FINISHED, threadId, runId },
      ) as Observable<BaseEvent>;
    }

    return super.connect(request).pipe(
      concatMap((event: BaseEvent) => {
        if (event.type !== EventType.MESSAGES_SNAPSHOT) return of(event);
        const snapshot = event as MessagesSnapshotEvent;
        const replayedResults: ToolCallResultEvent[] =
          snapshot.messages.flatMap((message: Message) => {
            if (message.role !== "assistant" || !message.toolCalls?.length)
              return [];
            return message.toolCalls.map<ToolCallResultEvent>(
              (toolCall: ToolCall) => ({
                type: EventType.TOOL_CALL_RESULT,
                toolCallId: toolCall.id,
                messageId: `${toolCall.id}-result`,
                content: "",
                role: "tool",
              }),
            );
          });
        return of(...replayedResults, snapshot) as Observable<BaseEvent>;
      }),
    );
  }
}
