import type {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import {
  AGUIConnectNotImplementedError,
  CompatibilityBoundary,
  EventType,
  randomUUID,
  structuredClone_,
  transformChunks,
} from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY, Subject, defer, lastValueFrom } from "rxjs";
import { catchError, finalize, takeUntil, tap } from "rxjs/operators";

/** Internal connection callbacks; HTTP connections keep their EOF behavior. */
export interface ConnectionReplayLifecycle {
  onReplayStarted?: () => void;
  onReplayFinished?: () => void;
}

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
 * The AG-UI 1.0 compatibility boundary still runs first, so stored 0.x history
 * is translated (THINKING_* events, `binary` parts, legacy nulls) exactly as in
 * the base pipeline. `enforceEvents` is omitted too: a replay is stored
 * history, and one event that the 1.0 schema rejects (the Intelligence gateway
 * replays RUN_STARTED without `runId`, for example) must not stop the whole
 * thread from hydrating. That keeps the leniency this path had before 1.0.
 *
 * Connection-local replay hooks track the phase before applying events. An
 * explicitly live RUN_ERROR clears busy without closing the connection;
 * historical errors remain data. Connections without hooks retain the existing
 * completion behavior.
 *
 * Apart from the above, this mirrors the base `AbstractAgent.connectAgent`
 * implementation, so callers keep the same subscriber notifications, detach
 * semantics, and `{ result, newMessages }` return shape.
 *
 * TODO: Remove this in favour of the base implementation once AG-UI's
 * AbstractAgent supports opting out of `verifyEvents` for transports whose
 * connection life-cycle isn't a single run AND preserves the connection-local
 * replay lifecycle and running-state behavior below. Skipping verification alone
 * is insufficient. As of `@ag-ui/client@1.0.1`
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
  connect?: (
    input: RunAgentInput,
    lifecycle: ConnectionReplayLifecycle,
  ) => Observable<BaseEvent>,
): Promise<RunAgentResult> {
  // Access protected/private members through a type escape hatch — they are
  // set and read by the base class and must be managed identically to the
  // original implementation. `any` is required because these fields are
  // private in AbstractAgent, and intersecting private+public members of the
  // same name produces `never`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self = agent as any;
  let finalizeRun = () => {
    agent.isRunning = false;
  };

  try {
    agent.isRunning = true;
    agent.agentId = agent.agentId ?? randomUUID();

    const input = self.prepareRunAgentInput(parameters);
    let result: RunAgentResult["result"];
    const previousMessageIds = new Set(agent.messages.map((m) => m.id));
    // Record the phase when an error arrives: subscriber callbacks may run
    // asynchronously after replay_complete has already changed the phase.
    let isReplaying = true;
    const liveErrors = new WeakSet<BaseEvent>();
    const subscribers: AgentSubscriber[] = [
      {
        onRunStartedEvent: () => {
          agent.isRunning = true;
        },
        onRunErrorEvent: ({ event }) => {
          if (liveErrors.has(event)) agent.isRunning = false;
        },
        onRunFinishedEvent: (event) => {
          if (event.outcome === "success") {
            result = event.result;
          }
        },
      },
      ...agent.subscribers,
      subscriber ?? {},
    ];

    const activeRunDetach$ = new Subject<void>();
    self.activeRunDetach$ = activeRunDetach$;
    let resolveCompletion: (() => void) | undefined;
    self.activeRunCompletionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    let detached = false;
    let finalized = false;
    const detachSubscription = activeRunDetach$.subscribe(() => {
      detached = true;
    });
    finalizeRun = () => {
      if (finalized) return;
      finalized = true;
      detachSubscription.unsubscribe();
      if (self.activeRunDetach$ === activeRunDetach$) {
        agent.isRunning = false;
        self.activeRunCompletionPromise = undefined;
        self.activeRunDetach$ = undefined;
        // Keep AG-UI's callback timing. A finalizer can await the next run.
        void self.onFinalize(input, subscribers);
      }
      resolveCompletion?.();
      resolveCompletion = undefined;
    };

    // Initialization can await subscribers that return state mutations.
    // Publish teardown first, then wait for those mutations before releasing it.
    await self.onInitialize(input, subscribers);
    if (detached) return { result: undefined, newMessages: [] };

    // Only an explicitly live error changes busy state. Connection lifetime
    // remains owned by the transport (Intelligence idle or HTTP EOF).
    const lifecycle: ConnectionReplayLifecycle = {
      onReplayStarted: () => {
        isReplaying = true;
        agent.isRunning = true;
      },
      onReplayFinished: () => {
        isReplaying = false;
      },
    };
    const source$ = defer(() =>
      // The boundary is a middleware; hand it a stand-in agent whose run() is
      // this connect stream, as AG-UI's own connect operator does internally.
      new CompatibilityBoundary().run(input, {
        run: () =>
          connect
            ? connect(input, lifecycle)
            : (self.connect(input) as Observable<BaseEvent>),
      } as unknown as AbstractAgent),
    ).pipe(
      // NOTE: enforceEvents is intentionally omitted here. See JSDoc above.
      tap((event) => {
        if (!isReplaying && event.type === EventType.RUN_ERROR) {
          liveErrors.add(event);
        }
      }),
      // transformChunks reassembles partial/streamed messages — still needed.
      transformChunks(self.debugLogger),
      // NOTE: verifyEvents is intentionally omitted here. See JSDoc above.
      takeUntil(activeRunDetach$),
    );

    const applied$ = self.apply(input, source$, subscribers);
    const processed$ = self.processApplyEvents(input, applied$, subscribers);

    await lastValueFrom(
      processed$.pipe(
        catchError((error: unknown) => {
          if (self.activeRunDetach$ !== activeRunDetach$) return EMPTY;
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
        finalize(() => finalizeRun()),
      ),
      { defaultValue: undefined },
    );

    const newMessages = structuredClone_(agent.messages).filter(
      (m) => !previousMessageIds.has(m.id),
    );
    return { result, newMessages };
  } finally {
    finalizeRun();
  }
}
