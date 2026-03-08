import { merge, Observable } from "rxjs";
import {
  filter,
  ignoreElements,
  map,
  mergeMap,
  scan,
  share,
  take,
} from "rxjs/operators";

export interface PhoenixChannelLike {
  on(event: string, callback: (payload: unknown) => void): unknown;
  onError?(callback: (reason?: unknown) => void): unknown;
  join(): {
    receive(status: string, callback: (payload?: unknown) => unknown): unknown;
  };
}

export interface PhoenixSocketLike {
  onError(callback: (error?: unknown) => void): unknown;
  onOpen(callback: () => void): unknown;
}

export function ɵobservePhoenixChannelEvent$<T>(
  channel: PhoenixChannelLike,
  eventName: string,
): Observable<T> {
  return new Observable<T>((observer) => {
    channel.on(eventName, (payload) => observer.next(payload as T));
    channel.onError?.(() => {});
  });
}

export function ɵjoinPhoenixChannel$(
  channel: PhoenixChannelLike,
): Observable<never> {
  return new Observable<void>((observer) => {
    channel
      .join()
      .receive("ok", () => observer.complete())
      .receive("error", (response?: unknown) => {
        observer.error(
          new Error(`Failed to join channel: ${JSON.stringify(response)}`),
        );
      })
      .receive("timeout", () => {
        observer.error(new Error("Timed out joining channel"));
      });
  }).pipe(ignoreElements());
}

export type ɵPhoenixJoinOutcome =
  | { type: "joined" }
  | { type: "error"; response?: unknown }
  | { type: "timeout" };

export function ɵobservePhoenixJoinOutcome$(
  channel: PhoenixChannelLike,
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

export function ɵobservePhoenixSocketOpen$(
  socket: PhoenixSocketLike,
): Observable<void> {
  return new Observable<void>((observer) => {
    socket.onOpen(() => observer.next());
  });
}

export function ɵobservePhoenixSocketError$(
  socket: PhoenixSocketLike,
): Observable<unknown> {
  return new Observable<unknown>((observer) => {
    socket.onError((error) => observer.next(error));
  });
}

export type ɵPhoenixSocketSignal =
  | { type: "open" }
  | { type: "error"; error?: unknown };

export function ɵobservePhoenixSocketSignals$(
  socket: PhoenixSocketLike,
): Observable<ɵPhoenixSocketSignal> {
  return merge(
    ɵobservePhoenixSocketOpen$(socket).pipe(map(() => ({ type: "open" as const }))),
    ɵobservePhoenixSocketError$(socket).pipe(
      map((error) => ({ type: "error" as const, error })),
    ),
  ).pipe(share());
}

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
    mergeMap((consecutiveErrors) => {
      throw new Error(
        `WebSocket connection failed after ${consecutiveErrors} consecutive errors`,
      );
    }),
  );
}
