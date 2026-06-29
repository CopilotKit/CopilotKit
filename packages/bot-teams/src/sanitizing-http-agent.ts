import { HttpAgent, parseSSEStream, runHttpRequest } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { map } from "rxjs";
import type { Observable } from "rxjs";

/**
 * An `HttpAgent` that tolerates the AG-UI event streams real agents emit.
 *
 * `@ag-ui/client`'s stock transform re-validates every streamed event against a
 * strict Zod schema. Some events that `@ag-ui/langgraph` legitimately emits fail
 * it (notably a `TOOL_CALL_START` whose `parentMessageId` is `null`: "Expected
 * string, received null"), and a single rejected event aborts the entire run.
 * That breaks LangGraph interrupts / human-in-the-loop on Teams, where the tool
 * call that triggers the interrupt carries exactly that shape.
 *
 * The bridge talks to a trusted runtime, so rather than re-validate its output
 * we use the same SSE parse the stock path wraps (`parseSSEStream`) and coerce
 * the known nullable-string fields. This deliberately drops the stock
 * transform's *entire* strict Zod re-validation step (not just the offending
 * field). This is acceptable only because the runtime is trusted and `runHttpRequest`
 * still throws on transport/HTTP errors. The first coercion logs a one-time
 * breadcrumb so the workaround is visible in production. Revert to the stock
 * transform (`transformHttpEventStream`) once upstream makes the fields
 * nullable.
 *
 * Use it in place of `HttpAgent` when pointing the Teams bot at a LangGraph
 * (or other AG-UI) agent:
 *
 * ```ts
 * import { SanitizingHttpAgent } from "@copilotkit/bot-teams";
 * const agent = new SanitizingHttpAgent({ url: process.env.AGENT_URL! });
 * ```
 */
export class SanitizingHttpAgent extends HttpAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return parseSSEStream(
      runHttpRequest(() => this.fetch(this.url, this.requestInit(input))),
      this.debugLogger,
    ).pipe(map((event: unknown) => coerceNullStrings(event) as BaseEvent));
  }
}

/** One-time breadcrumb so the workaround's use is visible in production. */
let coercionWarned = false;

/**
 * Coerce known nullable-string event fields to `""`. Targeted on purpose: we
 * only touch fields where a `null` is known to come through from
 * `@ag-ui/langgraph` and would otherwise trip a downstream string check.
 */
function coerceNullStrings(event: unknown): unknown {
  if (!event || typeof event !== "object") return event;
  const e = event as Record<string, unknown>;
  if (e["parentMessageId"] === null) {
    e["parentMessageId"] = "";
    if (!coercionWarned) {
      coercionWarned = true;
      console.warn(
        '[SanitizingHttpAgent] coerced a null `parentMessageId` to "" and ' +
          "bypassed @ag-ui/client strict event re-validation for this stream " +
          "(known @ag-ui/langgraph quirk). Remove this agent once upstream " +
          "makes the field nullable.",
      );
    }
  }
  return e;
}
