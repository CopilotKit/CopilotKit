import { Injectable } from "@angular/core";
import {
  filter,
  lastValueFrom,
  map,
  Observable,
  Subject,
  take,
  takeUntil,
} from "rxjs";

@Injectable({ providedIn: "root" })
export class HumanInTheLoop {
  results = new Subject<{
    toolCallId: string;
    toolName: string;
    result: unknown;
  }>();

  addResult(toolCallId: string, toolName: string, result: unknown) {
    this.results.next({ toolCallId, toolName, result });
  }

  onResult(
    toolCallId: string,
    toolName: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const result = this.results.pipe(
      filter(
        (entry) =>
          entry.toolCallId === toolCallId && entry.toolName === toolName,
      ),
      take(1),
      // Resolve with the bare result. toolCallId/toolName are routing keys for
      // this bus only — leaking them would make the tool result an envelope
      // that no consumer expects.
      map((entry) => entry.result),
    );
    if (!signal) return lastValueFrom(result);

    const aborted = new Observable<never>((subscriber) => {
      const onAbort = () =>
        subscriber.error(new Error("Human-in-the-loop interaction aborted"));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      return () => signal.removeEventListener("abort", onAbort);
    });

    // Completing the result detaches the abort listener. An abort errors the
    // stream, rejecting the promise and unsubscribing from results.
    return lastValueFrom(result.pipe(takeUntil(aborted)));
  }
}
