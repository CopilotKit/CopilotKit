/**
 * Synthetic AG-UI reasoning events for a backend that cannot emit its own.
 *
 * WHY THIS EXISTS
 * ---------------
 * The `reasoning-default` / `reasoning-custom` / `tool-rendering-reasoning-chain`
 * cells render CopilotKit's `reasoningMessage` slot, which is driven ONLY by the
 * AG-UI `REASONING_*` event family. Most backends emit that family themselves.
 * `Microsoft.Agents.AI.Hosting.AGUI.AspNetCore@1.0.0-preview.251110.1` does
 * not, so the two .NET integrations carried this shim in their OWN Next.js
 * runtime route and their cells passed there:
 *
 *   showcase/integrations/ms-agent-dotnet/src/app/api/copilotkit/route.ts
 *   showcase/integrations/ms-agent-harness-dotnet/src/app/api/copilotkit/route.ts
 *
 * Both copies are `createReasoningAgent`, and they are BYTE-IDENTICAL (verified
 * by diffing the two function bodies). This module is that one behaviour, moved
 * to where the unified runtime can apply it — otherwise migrating either slug's
 * demo pages to `showcase/frontends/nextjs` silently drops the reasoning cells
 * to "no reasoning bubble ever appears", which reads as a model problem.
 *
 * spring-ai is deliberately NOT a caller. Its route looked similar, but it does
 * not inject anything: `agents["reasoning-default"] = createAgent("/reasoning/")`
 * points at a dedicated Java `ReasoningController` that writes REAL
 * `REASONING_MESSAGE_*` frames. Its reasoning comes from the backend, so a shim
 * here would DOUBLE the events.
 *
 * TWO HALVES, AND BOTH ARE LOAD-BEARING
 * -------------------------------------
 *  1. OUTBOUND: a `REASONING_START / REASONING_MESSAGE_START /
 *     REASONING_MESSAGE_CONTENT / REASONING_MESSAGE_END / REASONING_END`
 *     sequence is injected on `RUN_STARTED` (or, if the stream produced no
 *     `RUN_STARTED` at all, on completion — so a cell still renders instead of
 *     hanging on a backend that answered oddly).
 *  2. INBOUND: `reasoning`-role messages are stripped from the replayed
 *     history. This is NOT tidiness. The events in (1) make the client hold a
 *     `reasoning`-role message, and it replays that message on the NEXT turn;
 *     the .NET AG-UI host's input mapper accepts only user/assistant/system/tool
 *     and rejects the whole request. Half a shim turns a working first turn into
 *     a broken second one.
 *
 * WHY `rxjs` IS IMPORTED WITHOUT BEING DECLARED
 * --------------------------------------------
 * `Middleware.run` must return an rxjs `Observable`, and `@ag-ui/client` does
 * not re-export the class. `rxjs` is an EXACT pin (`7.8.1`) of
 * `@ag-ui/client@0.0.57`, single-copy in this app's `package-lock.json`, and the
 * three integration routes that carry this shim import it the same way without
 * declaring it. Adding it to `package.json` is a lockfile change that belongs in
 * its own commit; if `@ag-ui/client` ever stops depending on it, this import is
 * the thing that breaks and it breaks loudly at build time.
 */

import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { EventType, FunctionMiddleware } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";

/**
 * The reasoning text the injected sequence streams, VERBATIM from
 * `createReasoningAgent` in both .NET routes.
 *
 * Exported so a test pins the string rather than restating it: the D6
 * reasoning-display probe asserts a non-empty reasoning bubble, so the text is
 * observable behaviour, not a detail.
 */
export const SYNTHETIC_REASONING_DELTA =
  "I am checking the request, choosing the relevant tool or answer path, and then summarizing the result.";

/**
 * Marks an agent this module has shimmed.
 *
 * A property rather than a middleware-count check, because a bare
 * `AbstractAgent` does NOT start with zero middlewares: its constructor
 * `unshift`s up to three `BackwardCompatibility_*` middlewares depending on
 * `maxVersion`, so counting them proves nothing. `Symbol.for` (not a private
 * symbol) so a test in another module can read it without importing an internal.
 */
const SYNTHETIC_REASONING_MARKER = Symbol.for(
  "showcase.syntheticReasoningApplied",
);

/** Whether {@link applySyntheticReasoning} has been applied to this agent. */
export function hasSyntheticReasoning(agent: object): boolean {
  return (
    (agent as Record<symbol, unknown>)[SYNTHETIC_REASONING_MARKER] === true
  );
}

/**
 * The five events, in order, for one run.
 *
 * `role: "reasoning"` on `REASONING_MESSAGE_START` is copied from the source and
 * is not optional decoration: it is what makes the client materialise a
 * `reasoning`-role message rather than an assistant one.
 *
 * Cast through `BaseEvent`, as the source does. These are structurally the
 * concrete `Reasoning*Event` shapes, but `BaseEvent` is what a middleware may
 * emit and the published per-event interfaces carry fields (timestamps,
 * `rawEvent`) that a synthetic event has no honest value for.
 */
export function syntheticReasoningEvents(messageId: string): BaseEvent[] {
  return [
    { type: EventType.REASONING_START, messageId } as BaseEvent,
    {
      type: EventType.REASONING_MESSAGE_START,
      messageId,
      role: "reasoning",
    } as BaseEvent,
    {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId,
      delta: SYNTHETIC_REASONING_DELTA,
    } as BaseEvent,
    { type: EventType.REASONING_MESSAGE_END, messageId } as BaseEvent,
    { type: EventType.REASONING_END, messageId } as BaseEvent,
  ];
}

/**
 * The message id the injected sequence uses: `<runId>-reasoning`.
 *
 * Derived from the run id so every event in one run shares one id and two runs
 * never collide. `randomUUID` when the input carries no `runId` — the source
 * does the same, and an `undefined` in the id would make every run of a
 * runId-less backend reuse the string `"undefined-reasoning"`.
 */
function reasoningMessageId(input: RunAgentInput): string {
  const runId = (input as { runId?: string }).runId;
  return `${runId ?? crypto.randomUUID()}-reasoning`;
}

/**
 * Drop `reasoning`-role messages from a run input. Returns a NEW input; the
 * caller's object is never mutated.
 *
 * `messages` absent stays absent (rather than becoming `[]`), so this cannot
 * turn "the caller sent no messages field" into "the caller sent an empty
 * history" — the source's `input.messages?.filter(...)` has the same property
 * and the .NET host distinguishes the two.
 */
export function stripReasoningMessages(input: RunAgentInput): RunAgentInput {
  return {
    ...input,
    messages: input.messages?.filter((message) => message.role !== "reasoning"),
  };
}

/**
 * The middleware body. Exported so a test can drive it with a scripted `next`
 * instead of a live backend.
 *
 * `next` is typed `AbstractAgent` by `MiddlewareFunction`, but at runtime the
 * composed chain hands over a structural `{ run, messages, state }` object, so
 * ONLY `next.run` may be touched here.
 */
export function syntheticReasoningMiddleware(
  input: RunAgentInput,
  next: AbstractAgent,
): Observable<BaseEvent> {
  const sanitized = stripReasoningMessages(input);
  const events = syntheticReasoningEvents(reasoningMessageId(input));

  return new Observable<BaseEvent>((subscriber) => {
    let injected = false;
    const injectReasoning = () => {
      // ONCE PER RUN. A stream with two `RUN_STARTED` events (or one
      // `RUN_STARTED` and then completion) would otherwise emit two reasoning
      // messages sharing one id, which renders as a duplicated bubble.
      if (injected) return;
      injected = true;
      for (const event of events) subscriber.next(event);
    };

    const subscription = next.run(sanitized).subscribe({
      next(event) {
        // AFTER the event, so `RUN_STARTED` still arrives first: the client
        // rejects a reasoning event that precedes the run it belongs to.
        subscriber.next(event);
        if (event.type === EventType.RUN_STARTED) injectReasoning();
      },
      error(error) {
        subscriber.error(error);
      },
      complete() {
        // The fallback arm. A backend that emitted no `RUN_STARTED` still gets
        // its reasoning bubble instead of leaving the cell blank.
        injectReasoning();
        subscriber.complete();
      },
    });

    return () => subscription.unsubscribe();
  });
}

/**
 * Attach the shim to an agent, and mark it as shimmed. Returns the same agent.
 *
 * `use` APPENDS, so this middleware ends up INNERMOST — closest to the HTTP
 * agent — which is where the source put it too (`createAgent` registers its
 * tool-call-id strip first, `createReasoningAgent` adds this one after). The
 * runtime clones an agent per request and `AbstractAgent.clone()` copies
 * `middlewares`, so attaching once at build time is enough.
 */
export function applySyntheticReasoning<T extends AbstractAgent>(agent: T): T {
  agent.use(new FunctionMiddleware(syntheticReasoningMiddleware));
  Object.defineProperty(agent, SYNTHETIC_REASONING_MARKER, {
    value: true,
    enumerable: false,
  });
  return agent;
}
