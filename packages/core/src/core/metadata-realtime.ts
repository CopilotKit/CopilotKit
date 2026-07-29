import type { Observable } from "rxjs";
import {
  Subject,
  catchError,
  map,
  of,
  share,
  shareReplay,
  takeUntil,
} from "rxjs";
import { phoenixExponentialBackoff } from "@copilotkit/shared";
import {
  ɵobservePhoenixSocketHealth$,
  ɵobservePhoenixSocketSignals$,
  ɵphoenixSocket$,
} from "../utils/phoenix-observable";
import type { ɵPhoenixSocketSession } from "../utils/phoenix-observable";

export const ɵMETADATA_MAX_SOCKET_RETRIES = 5;

/**
 * Consumer-facing view of the shared metadata socket handed to stores.
 *
 * Credential-agnostic: the module never fetches anything. The consumer
 * (CopilotKitCore) supplies the `joinToken`; threads and memory each join
 * their own channel off the same `socket$`, so both feeds share one
 * kept-open Phoenix socket instead of opening their own.
 *
 * Intentionally has NO `dispose` — stores must not be able to tear down the
 * shared socket. Only the owner (CopilotKitCore) can, via the handle.
 */
export interface ɵMetadataSocket {
  /** Hot, shared, kept-open Phoenix socket. refCount:false — stays open
   *  across channel churn; only the owner's dispose() tears it down. */
  socket$: Observable<ɵPhoenixSocketSession>;
  /** Fatal give-up after {@link ɵMETADATA_MAX_SOCKET_RETRIES} consecutive
   *  socket errors. Latched (replayed to late subscribers), emits at most
   *  once, never throws. */
  socketFatal$: Observable<void>;
}

/**
 * Owner handle for the shared metadata socket, held ONLY by CopilotKitCore.
 * Exposes the consumer view plus the sole teardown entry point.
 */
export interface ɵMetadataSocketHandle {
  readonly socket: ɵMetadataSocket;
  /** Idempotent teardown: disconnects the socket and completes all streams. */
  dispose(): void;
}

export function ɵcreateMetadataSocket(deps: {
  wsUrl: string;
  joinToken: string;
}): ɵMetadataSocketHandle {
  const teardown$ = new Subject<void>();

  const socket$ = ɵphoenixSocket$({
    url: deps.wsUrl,
    options: {
      params: { join_token: deps.joinToken },
      reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
      rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
    },
  }).pipe(
    takeUntil(teardown$),
    // Hot + no per-subscriber refcount: connects on first subscribe, stays
    // open across channel churn, closed only by dispose().
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  const socketSignals$ = ɵobservePhoenixSocketSignals$(socket$).pipe(share());
  const socketFatal$ = ɵobservePhoenixSocketHealth$(
    socketSignals$,
    ɵMETADATA_MAX_SOCKET_RETRIES,
  ).pipe(
    catchError(() => {
      console.warn(
        `[metadata] WebSocket failed after ${ɵMETADATA_MAX_SOCKET_RETRIES} attempts, giving up`,
      );
      return of(undefined);
    }),
    map(() => undefined),
    takeUntil(teardown$),
    // shareReplay (not share) so a late subscriber — a store re-subscribing
    // after a prior give-up — immediately observes the terminal give-up.
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  // Eagerly subscribe the health chain so socket-health monitoring and the
  // give-up warn run regardless of which/whether stores subscribe. This also
  // opens the socket immediately, which is correct: the module is only
  // constructed once a consumer has decided to connect.
  const healthSub = socketFatal$.subscribe();

  const socket: ɵMetadataSocket = { socket$, socketFatal$ };

  return {
    socket,
    dispose: () => {
      if (!teardown$.closed) {
        teardown$.next();
        teardown$.complete();
        healthSub.unsubscribe();
      }
    },
  };
}
