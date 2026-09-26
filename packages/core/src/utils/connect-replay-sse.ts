import type { BaseEvent, runHttpRequest } from "@ag-ui/client";
import { transformHttpEventStream } from "@ag-ui/client";
import {
  CONNECTION_REPLAY_FINISHED,
  CONNECTION_REPLAY_STARTED,
} from "@copilotkit/shared";
import type { ConnectionReplayLifecycle } from "@copilotkit/shared";
import { Observable, Subscription } from "rxjs";

type HttpEvents = ReturnType<typeof runHttpRequest>;
type HttpEvent = HttpEvents extends Observable<infer Event> ? Event : never;
type HttpDataEvent = Extract<HttpEvent, { type: "data" }>;

/** Own the HTTP subscription: AG-UI's eager decoder does not propagate teardown.
 * Completing/detaching a connection must cancel its reader and stop its hooks.
 */
export function ɵtransformConnectStream(
  source: HttpEvents,
  lifecycle?: ConnectionReplayLifecycle,
): Observable<BaseEvent> {
  return new Observable((subscriber) => {
    const owned = new Subscription();
    const input = new Observable<HttpEvent>((observer) => {
      const subscription = ɵconsumeReplayControls(source, lifecycle).subscribe(
        observer,
      );
      owned.add(subscription);
      return subscription;
    });
    owned.add(transformHttpEventStream(input).subscribe(subscriber));
    return owned;
  });
}

/** Consume named SSE controls before AG-UI decoding. Emit each ordinary frame
 * immediately, so hooks cannot overtake historical events in the same chunk.
 */
export function ɵconsumeReplayControls(
  source: HttpEvents,
  lifecycle?: ConnectionReplayLifecycle,
): HttpEvents {
  return new Observable((subscriber) => {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let isSse = false;
    let pending = "";
    let lines: string[] = [];
    let skipLeadingLf = false;
    let lastDataEvent: HttpDataEvent | undefined;
    const emitFrame = (event: HttpDataEvent) => {
      const frameLines = lines;
      lines = [];
      const name = frameLines.reduce((eventName, field) => {
        if (field === "event") return "";
        if (!field.startsWith("event:")) return eventName;
        return field.slice(6).replace(/^ /, "");
      }, "");
      if (name === CONNECTION_REPLAY_STARTED) lifecycle?.onReplayStarted?.();
      else if (name === CONNECTION_REPLAY_FINISHED)
        lifecycle?.onReplayFinished?.();
      else
        subscriber.next({
          ...event,
          data: encoder.encode(frameLines.join("\n") + "\n\n"),
        });
    };
    return source.subscribe({
      next: (event) => {
        if (event.type === "headers") {
          isSse =
            event.headers.get("content-type")?.includes("text/event-stream") ??
            false;
          subscriber.next(event);
          return;
        }
        if (!isSse || !event.data) {
          subscriber.next(event);
          return;
        }
        lastDataEvent = event;
        const chunk = decoder.decode(event.data, { stream: true });
        if (!chunk) return;
        pending +=
          skipLeadingLf && chunk.startsWith("\n") ? chunk.slice(1) : chunk;
        skipLeadingLf = false;
        while (!subscriber.closed) {
          const match = /\r\n|\r|\n/.exec(pending);
          if (!match) break;
          // Treat CRLF split across chunks as a single line ending.
          skipLeadingLf =
            match[0] === "\r" && match.index === pending.length - 1;
          const line = pending.slice(0, match.index);
          pending = pending.slice(match.index + match[0].length);
          if (line !== "") {
            lines.push(line);
            continue;
          }
          emitFrame(event);
        }
      },
      error: (error) => subscriber.error(error),
      complete: () => {
        // Match AG-UI's existing EOF behavior for a final unterminated frame.
        pending += decoder.decode();
        if (pending) lines.push(pending);
        if (lastDataEvent && lines.length) emitFrame(lastDataEvent);
        subscriber.complete();
      },
    });
  });
}
