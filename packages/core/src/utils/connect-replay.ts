import type {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import {
  AGUIConnectNotImplementedError,
  randomUUID,
  structuredClone_,
  transformChunks,
} from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY, Subject, defer, lastValueFrom } from "rxjs";
import { catchError, finalize, takeUntil } from "rxjs/operators";

/**
 * Runs an agent's `connect()` stream through the AbstractAgent apply pipeline
 * with the `verifyEvents` step omitted.
 *
 * `verifyEvents` enforces AG-UI's *single run* lifecycle rules: exactly one
 * RUN_STARTED opening the stream, no events after a terminal RUN_FINISHED /
 * RUN_ERROR. Those rules are correct for `/run`, but a `/connect` response is a
 * replay of a thread's history and can legitimately carry several past runs
 * back to back — including a run that ended in RUN_ERROR followed by a later
 * RUN_STARTED. Verifying a replay against single-run rules makes hydration of
 * an existing thread fail outright:
 *
 *   Cannot send event type 'RUN_STARTED': The run has already errored with
 *   'RUN_ERROR'. No further events can be sent.
 *
 * `transformChunks` is still applied — message reassembly is needed either way.
 *
 * This mirrors the base `AbstractAgent.connectAgent` implementation exactly
 * apart from that omission, so callers keep the same subscriber notifications,
 * detach semantics, and `{ result, newMessages }` return shape.
 *
 * TODO: Remove this in favour of the base implementation once AG-UI's
 * AbstractAgent supports opting out of `verifyEvents` for transports whose
 * connection life-cycle isn't a single run. As of `@ag-ui/client@0.0.57`
 * `connectAgent(parameters?, subscriber?)` takes no such option.
 *
 * @param agent - The agent whose `connect()` stream should be consumed.
 * @param parameters - Run parameters, forwarded to `prepareRunAgentInput`.
 * @param subscriber - Optional one-shot subscriber for this connect call.
 */
export async function ɵconnectWithoutEventVerification(
  agent: AbstractAgent,
  parameters?: RunAgentParameters,
  subscriber?: AgentSubscriber,
): Promise<RunAgentResult> {
  // Access protected/private members through a type escape hatch — they are
  // set and read by the base class and must be managed identically to the
  // original implementation. `any` is required because these fields are
  // private in AbstractAgent, and intersecting private+public members of the
  // same name produces `never`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self = agent as any;

  try {
    agent.isRunning = true;
    agent.agentId = agent.agentId ?? randomUUID();

    const input = self.prepareRunAgentInput(parameters);
    let result: RunAgentResult["result"];
    const previousMessageIds = new Set(agent.messages.map((m) => m.id));
    const subscribers: AgentSubscriber[] = [
      {
        onRunFinishedEvent: (event) => {
          if (event.outcome === "success") {
            result = event.result;
          }
        },
      },
      ...agent.subscribers,
      subscriber ?? {},
    ];

    await self.onInitialize(input, subscribers);

    self.activeRunDetach$ = new Subject<void>();
    let resolveCompletion: (() => void) | undefined;
    self.activeRunCompletionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const source$ = defer(
      () => self.connect(input) as Observable<BaseEvent>,
    ).pipe(
      // transformChunks reassembles partial/streamed messages — still needed.
      transformChunks(self.debugLogger),
      // NOTE: verifyEvents is intentionally omitted here. See JSDoc above.
      takeUntil(self.activeRunDetach$),
    );

    const applied$ = self.apply(input, source$, subscribers);
    const processed$ = self.processApplyEvents(input, applied$, subscribers);

    await lastValueFrom(
      processed$.pipe(
        catchError((error: unknown) => {
          agent.isRunning = false;
          // An agent that doesn't implement connect() is not an error worth
          // surfacing: the base pipeline swallows it, and callers rely on that.
          // `CopilotKitCore` awaits `detachActiveRun()` before every run, which
          // only resolves because this path still reaches the finalize block
          // below (see the historical note in run-handler.ts). Routing it
          // through onError would also fire run-failure callbacks on every
          // subscriber for a benign condition.
          if (error instanceof AGUIConnectNotImplementedError) {
            return EMPTY;
          }
          return self.onError(input, error, subscribers);
        }),
        finalize(() => {
          agent.isRunning = false;
          void self.onFinalize(input, subscribers);
          resolveCompletion?.();
          resolveCompletion = undefined;
          self.activeRunCompletionPromise = undefined;
          self.activeRunDetach$ = undefined;
        }),
      ),
      { defaultValue: undefined },
    );

    const newMessages = structuredClone_(agent.messages).filter(
      (m) => !previousMessageIds.has(m.id),
    );
    return { result, newMessages };
  } finally {
    agent.isRunning = false;
  }
}
