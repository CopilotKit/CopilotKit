import type { Observable } from "rxjs";
import {
  Subject,
  catchError,
  defer,
  map,
  of,
  share,
  shareReplay,
  switchMap,
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
 * The shared per-user metadata realtime connection. Threads and memory each
 * join their own channel off the same `socket$`, so both feeds share one
 * lazily-created, kept-open Phoenix socket instead of opening their own.
 */
export interface ɵMetadataRealtimeConnection {
  /** Hot, shared, lazily-connected Phoenix socket. refCount:false — stays open
   *  across channel churn; only dispose() (or a fatal give-up) tears it down. */
  socket$: Observable<ɵPhoenixSocketSession>;
  /** The per-user metadata join code `R`, replayed to late subscribers. */
  joinCode$: Observable<string>;
  /** Fatal socket give-up (after MAX_SOCKET_RETRIES). Shared by all channels;
   *  emits once then completes. Never throws. */
  socketFatal$: Observable<void>;
  /** Idempotent teardown: disconnects the socket and completes all streams. */
  dispose(): void;
}

export function ɵcreateMetadataRealtimeConnection(deps: {
  wsUrl: string;
  fetchSubscription: () => Promise<{ joinToken: string; joinCode: string }>;
}): ɵMetadataRealtimeConnection {
  const teardown$ = new Subject<void>();

  // One-shot metadata subscription (join token + code R), shared by all
  // subscribers. Matches today's behavior: fetched once per connection.
  const subscription$ = defer(() => deps.fetchSubscription()).pipe(
    shareReplay(1),
  );

  const joinCode$ = subscription$.pipe(
    map((s) => s.joinCode),
    shareReplay(1),
  );

  const socket$ = subscription$.pipe(
    switchMap(({ joinToken }) =>
      ɵphoenixSocket$({
        url: deps.wsUrl,
        options: {
          params: { join_token: joinToken },
          reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
          rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
        },
      }),
    ),
    takeUntil(teardown$),
    // Lazy + hot + no per-subscriber refcount: connects on first subscribe,
    // stays open across channel churn, closed only by dispose()/fatal.
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
    share(),
  );

  return {
    socket$,
    joinCode$,
    socketFatal$,
    dispose: () => {
      if (!teardown$.closed) {
        teardown$.next();
        teardown$.complete();
      }
    },
  };
}
