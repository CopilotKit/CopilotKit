import { Socket } from "phoenix";
import { EMPTY, NEVER, Observable, concat, defer, of, throwError } from "rxjs";
import {
  filter,
  finalize,
  mergeMap,
  scan,
  shareReplay,
  switchMap,
  take,
} from "rxjs/operators";

/**
 * Minimal Phoenix push contract used by the observable adapters.
 */
export interface ɵPhoenixPushLike {
  receive(status: string, callback: (payload?: unknown) => unknown): unknown;
}

/**
 * Minimal Phoenix channel contract used by the observable adapters.
 */
export interface ɵPhoenixChannelLike {
  on(event: string, callback: (payload: unknown) => void): number;
  off(event: string, ref?: number): void;
  onError?(callback: (reason?: unknown) => void): unknown;
  join(params?: Record<string, unknown>): ɵPhoenixPushLike;
  push?(event: string, payload: unknown): ɵPhoenixPushLike;
  leave(): void;
}

/**
 * Minimal Phoenix socket contract used by the observable adapters.
 */
export interface ɵPhoenixSocketLike {
  connect(): void;
  disconnect(): void;
  channel(topic: string, params?: Record<string, unknown>): ɵPhoenixChannelLike;
  onError(callback: (error?: unknown) => void): unknown;
  onOpen(callback: () => void): unknown;
}

/**
 * Socket lifecycle notifications exposed by {@link ɵphoenixSocket$}.
 */
export type ɵPhoenixSocketSignal =
  | { type: "open" }
  | { type: "error"; error?: unknown };

/**
 * Terminal outcomes of a Phoenix channel join attempt.
 */
export type ɵPhoenixJoinOutcome =
  | { type: "joined" }
  | { type: "error"; response?: unknown }
  | { type: "timeout" };

/**
 * Active Phoenix socket session plus its derived lifecycle stream.
 */
export interface ɵPhoenixSocketSession {
  socket: ɵPhoenixSocketLike;
  signals$: Observable<ɵPhoenixSocketSignal>;
}

/**
 * Active Phoenix channel session plus its derived join-outcome stream.
 */
export interface ɵPhoenixChannelSession {
  channel: ɵPhoenixChannelLike;
  joinOutcome$: Observable<ɵPhoenixJoinOutcome>;
}

/**
 * Options for creating a cold Phoenix socket session stream.
 */
export interface ɵPhoenixSocketOptions {
  url: string;
  options?: Record<string, unknown>;
}

/**
 * Options for creating a cold Phoenix channel session stream from a socket stream.
 */
export interface ɵPhoenixChannelOptions {
  socket$: Observable<ɵPhoenixSocketSession>;
  topic: string;
  params?: Record<string, unknown>;
  leaveOnUnsubscribe?: boolean;
}

/**
 * Adapt Phoenix socket open/error callbacks into an observable signal stream.
 *
 * The returned observable is shared and replayable by the caller when needed,
 * but this helper itself does not own socket connection teardown.
 */
function ɵcreatePhoenixSocketSignals$(
  socket: ɵPhoenixSocketLike,
): Observable<ɵPhoenixSocketSignal> {
  return new Observable<ɵPhoenixSocketSignal>((observer) => {
    socket.onOpen(() => observer.next({ type: "open" }));
    socket.onError((error) => observer.next({ type: "error", error }));
  });
}

/**
 * Adapt a Phoenix channel join attempt into a single-outcome observable.
 */
function ɵcreatePhoenixJoinOutcome$(
  channel: ɵPhoenixChannelLike,
): Observable<ɵPhoenixJoinOutcome> {
  return new Observable<ɵPhoenixJoinOutcome>((observer) => {
    channel
      .join()
      .receive("ok", () => {
        observer.next({ type: "joined" });
        observer.complete();
      })
      .receive("error", (response?: unknown) => {
        observer.next({ type: "error", response });
        observer.complete();
      })
      .receive("timeout", () => {
        observer.next({ type: "timeout" });
        observer.complete();
      });
  });
}

/**
 * Create a cold Phoenix socket session.
 *
 * The socket is constructed and connected on subscription, and disconnected on
 * teardown. Each subscription creates an isolated socket instance.
 */
export function ɵphoenixSocket$(
  options: ɵPhoenixSocketOptions,
): Observable<ɵPhoenixSocketSession> {
  return defer(() => {
    const socket = new Socket(
      options.url,
      options.options as ConstructorParameters<typeof Socket>[1],
    ) as ɵPhoenixSocketLike;
    const signals$ = ɵcreatePhoenixSocketSignals$(socket).pipe(
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    socket.connect();

    return concat(
      of({
        socket,
        signals$,
      }),
      NEVER,
    ).pipe(finalize(() => socket.disconnect()));
  });
}

/**
 * Create a cold Phoenix channel session from a socket session stream.
 *
 * A channel is created and joined for each active socket session. If the
 * upstream socket session changes, the previous channel is left before the
 * next one becomes active.
 */
export function ɵphoenixChannel$(
  options: ɵPhoenixChannelOptions,
): Observable<ɵPhoenixChannelSession> {
  return options.socket$.pipe(
    switchMap(({ socket }) =>
      defer(() => {
        const channel = socket.channel(options.topic, options.params);
        const joinOutcome$ = ɵcreatePhoenixJoinOutcome$(channel).pipe(
          shareReplay({ bufferSize: 1, refCount: true }),
        );

        return concat(
          of({
            channel,
            joinOutcome$,
          }),
          NEVER,
        ).pipe(
          finalize(() => {
            if (options.leaveOnUnsubscribe !== false) {
              channel.leave();
            }
          }),
        );
      }),
    ),
  );
}

/**
 * Observe a named Phoenix channel event as an observable payload stream.
 */
export function ɵobservePhoenixEvent$<T>(
  channel: ɵPhoenixChannelLike,
  eventName: string,
): Observable<T> {
  return new Observable<T>((observer) => {
    const ref = channel.on(eventName, (payload) => observer.next(payload as T));

    return () => {
      channel.off(eventName, ref);
    };
  });
}

/**
 * Flatten channel sessions into their join-outcome stream.
 */
export function ɵobservePhoenixJoinOutcome$(
  channel$: Observable<ɵPhoenixChannelSession>,
): Observable<ɵPhoenixJoinOutcome> {
  return channel$.pipe(switchMap((session) => session.joinOutcome$));
}

/**
 * Complete when a channel joins successfully, or error if the join fails.
 */
export function ɵjoinPhoenixChannel$(
  channel$: Observable<ɵPhoenixChannelSession>,
): Observable<never> {
  return ɵobservePhoenixJoinOutcome$(channel$).pipe(
    take(1),
    mergeMap((outcome) => {
      if (outcome.type === "joined") {
        return EMPTY;
      }

      throw outcome.type === "timeout"
        ? new Error("Timed out joining channel")
        : new Error(
            `Failed to join channel: ${JSON.stringify(outcome.response)}`,
          );
    }),
  );
}

/**
 * Flatten socket sessions into their lifecycle signal stream.
 */
export function ɵobservePhoenixSocketSignals$(
  socket$: Observable<ɵPhoenixSocketSession>,
): Observable<ɵPhoenixSocketSignal> {
  return socket$.pipe(switchMap((session) => session.signals$));
}

/**
 * Error after a socket emits the configured number of consecutive error
 * signals, resetting the counter after each successful open signal.
 */
export function ɵobservePhoenixSocketHealth$(
  socketSignals$: Observable<ɵPhoenixSocketSignal>,
  maxConsecutiveErrors: number,
): Observable<never> {
  return socketSignals$.pipe(
    scan(
      (consecutiveErrors, signal) =>
        signal.type === "open" ? 0 : consecutiveErrors + 1,
      0,
    ),
    filter((consecutiveErrors) => consecutiveErrors >= maxConsecutiveErrors),
    take(1),
    mergeMap((consecutiveErrors) =>
      throwError(
        () =>
          new Error(
            `WebSocket connection failed after ${consecutiveErrors} consecutive errors`,
          ),
      ),
    ),
  );
}
