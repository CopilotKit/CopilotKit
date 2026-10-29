import { EventType, Middleware } from "@ag-ui/client";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { isDeepStrictEqual } from "node:util";
import { Observable, Subscription } from "rxjs";
import { z } from "zod";
import type { ThreadMessage } from "../intelligence-platform/client";

const eventName = "ag-ui:pending-frontend-results";
const checkpointSchema = z
  .object({
    version: z.literal(1),
    threadId: z.string(),
    runId: z.string(),
    pending: z.array(
      z
        .object({
          toolCallId: z.string().min(1),
          toolName: z.string().min(1),
          arguments: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();
type Checkpoint = z.infer<typeof checkpointSchema>;

/** Only installed after native-history admission, with the trusted persisted transcript. */
export class NativeResultRecoveryMiddleware extends Middleware {
  constructor(private readonly history: ThreadMessage[]) {
    super();
  }

  private candidates(checkpoint: Checkpoint): Message[] {
    return checkpoint.pending.flatMap((pending) => {
      const calls = this.history.flatMap((message) =>
        message.role === "assistant"
          ? (message.toolCalls ?? []).filter(
              (call) => call.id === pending.toolCallId,
            )
          : [],
      );
      const results = this.history.filter(
        (message) =>
          message.role === "tool" && message.toolCallId === pending.toolCallId,
      );
      if (
        calls.length !== 1 ||
        results.length !== 1 ||
        calls[0].name !== pending.toolName ||
        typeof results[0].content !== "string"
      )
        return [];
      let args: unknown;
      try {
        args = JSON.parse(calls[0].args || "{}");
      } catch {
        return [];
      }
      if (!isDeepStrictEqual(args, pending.arguments)) return [];
      return [
        {
          id: results[0].id,
          role: "tool" as const,
          toolCallId: pending.toolCallId,
          content: results[0].content,
        },
      ];
    });
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      const subscriptions = new Subscription();
      const recovered = new Set<string>();
      let retry: Message[] | undefined;
      const execute = (value: RunAgentInput, continuation: boolean) => {
        let checkpoint: Checkpoint | undefined;
        let checkpointCount = 0;
        let terminal: BaseEvent | undefined;
        let failed = false;
        let started = false;
        subscriptions.add(
          this.runNext(value, next).subscribe({
            next: (event) => {
              if (
                event.type === EventType.RUN_STARTED &&
                "threadId" in event &&
                "runId" in event &&
                event.threadId === input.threadId &&
                event.runId === input.runId
              )
                started = true;
              if (event.type === EventType.RUN_ERROR) failed = true;
              if (
                event.type === EventType.TOOL_CALL_RESULT &&
                "toolCallId" in event &&
                typeof event.toolCallId === "string"
              )
                recovered.add(event.toolCallId);
              if (
                event.type === EventType.CUSTOM &&
                "name" in event &&
                event.name === eventName
              ) {
                checkpointCount++;
                const parsed = checkpointSchema.safeParse(
                  "value" in event ? event.value : undefined,
                );
                if (
                  started &&
                  parsed.success &&
                  parsed.data.threadId === input.threadId &&
                  parsed.data.runId === input.runId &&
                  new Set(parsed.data.pending.map((p) => p.toolCallId)).size ===
                    parsed.data.pending.length
                )
                  checkpoint = parsed.data;
              }
              if (event.type === EventType.RUN_FINISHED) {
                terminal = event;
                return;
              }
              if (continuation && event.type === EventType.RUN_STARTED) return;
              subscriber.next(event);
            },
            error: (error) => subscriber.error(error),
            complete: () => {
              if (subscriber.closed) return;
              const trusted =
                started &&
                !failed &&
                terminal &&
                "threadId" in terminal &&
                "runId" in terminal &&
                terminal.threadId === input.threadId &&
                terminal.runId === input.runId &&
                checkpointCount === 1
                  ? checkpoint
                  : undefined;
              if (!continuation && trusted) {
                retry = this.candidates(trusted).filter(
                  (message) =>
                    message.role === "tool" &&
                    !recovered.has(message.toolCallId),
                );
                if (retry.length) {
                  // The checkpoint is the sole authority to retry. Never resend user input,
                  // assistant history, approval decisions, or execute frontend handlers.
                  execute(
                    { ...input, messages: retry, resume: undefined },
                    true,
                  );
                  return;
                }
              }
              if (continuation && trusted && retry) {
                const pending = new Set(
                  trusted.pending.map((p) => p.toolCallId),
                );
                for (const message of retry) {
                  if (
                    message.role === "tool" &&
                    !pending.has(message.toolCallId) &&
                    !recovered.has(message.toolCallId)
                  ) {
                    subscriber.next({
                      type: EventType.TOOL_CALL_RESULT,
                      messageId: message.id,
                      toolCallId: message.toolCallId,
                      content: message.content,
                      role: "tool",
                    });
                  }
                }
              }
              if (
                continuation &&
                !failed &&
                retry?.some(
                  (message) =>
                    message.role === "tool" &&
                    !recovered.has(message.toolCallId) &&
                    (!trusted ||
                      trusted.pending.some(
                        (p) => p.toolCallId === message.toolCallId,
                      )),
                )
              ) {
                subscriber.next({
                  type: EventType.RUN_ERROR,
                  message:
                    "Native backend did not confirm recovered frontend results",
                });
              } else if (terminal && !failed) subscriber.next(terminal);
              subscriber.complete();
            },
          }),
        );
      };
      execute(input, false);
      return () => subscriptions.unsubscribe();
    });
  }
}
