import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";

/**
 * An agent with the per-thread cursors the Intelligence agent keeps, and a
 * detach a test can hold open. Records which cursors were cleared.
 */
export class CursorAgent extends AbstractAgent {
  readonly clearedReplayCursors: string[] = [];
  readonly clearedReconnectCursors: string[] = [];
  detachCount = 0;
  private detachGate: Promise<void> = Promise.resolve();

  run(): Observable<BaseEvent> {
    return EMPTY;
  }

  /** Makes the next detaches wait for `gate`. */
  holdDetach(gate: Promise<void>) {
    this.detachGate = gate;
  }

  override async detachActiveRun() {
    this.detachCount++;
    await this.detachGate;
  }

  clearReplayCursor(threadId: string) {
    this.clearedReplayCursors.push(threadId);
  }

  clearReconnectCursor(threadId: string) {
    this.clearedReconnectCursors.push(threadId);
  }
}

/** A promise a test settles by hand. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued promise callback run. */
export function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
