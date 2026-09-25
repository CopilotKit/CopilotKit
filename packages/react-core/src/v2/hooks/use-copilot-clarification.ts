import { useSyncExternalStore } from "react";

export type CopilotClarificationRequest = {
  question: string;
  agentId: string;
  threadId: string;
};

export type CopilotClarificationResult =
  | { status: "answered"; answer: string }
  | { status: "cancelled" };

export interface CopilotClarificationStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CopilotClarificationRequest | undefined;
  respond(event: Event | { nativeEvent: Event }, answer: string): boolean;
  cancel(): void;
}

/** A human-authored answer to one agent clarification question. */
export class CopilotClarificationController implements CopilotClarificationStore {
  private pending?: CopilotClarificationRequest;
  private resolve?: (result: CopilotClarificationResult) => void;
  private signal?: AbortSignal;
  private listeners = new Set<() => void>();
  private onAbort = () => this.cancel();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.pending;

  request(
    request: CopilotClarificationRequest,
    signal?: AbortSignal,
  ): Promise<CopilotClarificationResult> {
    if (this.pending) throw new Error("Another clarification is pending");
    if (signal?.aborted) return Promise.resolve({ status: "cancelled" });
    this.pending = { ...request };
    this.signal = signal;
    signal?.addEventListener("abort", this.onAbort, { once: true });
    const result = new Promise<CopilotClarificationResult>((resolve) => {
      this.resolve = resolve;
    });
    this.emit();
    if (signal?.aborted) this.cancel();
    return result;
  }

  respond(event: Event | { nativeEvent: Event }, answer: string): boolean {
    if (!this.pending) return false;
    const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
    if (
      typeof Event === "undefined" ||
      !(nativeEvent instanceof Event) ||
      !nativeEvent.isTrusted ||
      !answer.trim() ||
      answer.length > 500
    )
      return false;
    this.finish({ status: "answered", answer: answer.trim() });
    return true;
  }

  cancel(): void {
    if (this.pending) this.finish({ status: "cancelled" });
  }

  private finish(result: CopilotClarificationResult): void {
    this.signal?.removeEventListener("abort", this.onAbort);
    this.signal = undefined;
    this.pending = undefined;
    const resolve = this.resolve;
    this.resolve = undefined;
    this.emit();
    resolve?.(result);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const emptySubscribe = () => () => {};
const emptySnapshot = () => undefined;

/** Headless clarification state for a custom chat or external consumer. */
/**
 * @example
 * const state = useCopilotClarification(controller);
 * // Render state in your review surface; the hook cleans up its subscription.
 */
export function useCopilotClarification(
  controller?: CopilotClarificationStore,
) {
  const request = useSyncExternalStore(
    controller?.subscribe ?? emptySubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  if (!request || !controller) return undefined;
  return {
    request,
    respond: (event: Event | { nativeEvent: Event }, answer: string) =>
      controller.respond(event, answer),
    cancel: () => controller.cancel(),
  };
}
