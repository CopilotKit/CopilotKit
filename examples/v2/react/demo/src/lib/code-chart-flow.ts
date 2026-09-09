import type { RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { concat, defer, EMPTY, filter, map, tap } from "rxjs";

export function isCodeChartRequest(input: RunAgentInput): boolean {
  const message = input.messages.at(-1);
  if (message?.role !== "user" || typeof message.content !== "string")
    return false;
  return (
    /linear regression/i.test(message.content) &&
    /python/i.test(message.content) &&
    /chart/i.test(message.content) &&
    /keywords?/i.test(message.content) &&
    input.tools.some((tool) => tool.name === "showDemoChart")
  );
}

/** Stream code, then a required chart call, as one cancellable AG-UI run. */
export function streamCodeThenChart<
  E extends { type: string; [key: string]: unknown },
>(
  input: RunAgentInput,
  writeCode: (input: RunAgentInput) => Observable<E>,
  makeChart: (input: RunAgentInput) => Observable<E>,
): Observable<E> {
  return defer(() => {
    const messages = new Map<string, string>();
    let finished = false;
    let failed = false;
    const usage: unknown[] = [];
    return concat(
      defer(() => writeCode({ ...input, tools: [] })).pipe(
        tap((event) => {
          if (
            (event.type === "TEXT_MESSAGE_CONTENT" ||
              event.type === "TEXT_MESSAGE_CHUNK") &&
            typeof event.messageId === "string" &&
            typeof event.delta === "string"
          ) {
            const { messageId, delta } = event;
            messages.set(messageId, (messages.get(messageId) ?? "") + delta);
          }
          if (event.type === "RUN_FINISHED") {
            finished = true;
            if ("usage" in event && Array.isArray(event.usage))
              usage.push(...event.usage);
          }
          if (event.type === "RUN_ERROR") failed = true;
        }),
        filter((event) => event.type !== "RUN_FINISHED"),
        map((event) =>
          event.type === "RUN_STARTED" ? { ...event, input } : event,
        ),
      ),
      defer(() => {
        if (failed) return EMPTY;
        if (
          !finished ||
          ![...messages.values()].some((text) =>
            /```python\s+[\s\S]+?```/.test(text),
          )
        ) {
          throw new Error(
            "Code generation did not produce a complete Python code block.",
          );
        }
        return makeChart({
          ...input,
          tools: input.tools.filter((tool) => tool.name === "showDemoChart"),
          messages: [
            ...input.messages,
            ...[...messages].map(([id, content]) => ({
              id,
              role: "assistant" as const,
              content,
            })),
          ],
        }).pipe(
          filter((event) => event.type !== "RUN_STARTED"),
          map((event) =>
            event.type === "RUN_FINISHED" && usage.length
              ? {
                  ...event,
                  usage: [
                    ...usage,
                    ...("usage" in event && Array.isArray(event.usage)
                      ? event.usage
                      : []),
                  ],
                }
              : event,
          ),
        );
      }),
    );
  });
}
