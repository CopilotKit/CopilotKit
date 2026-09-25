import { useSyncExternalStore } from "react";
import { recordAutopilotToolTrace } from "@copilotkit/core";

export type CopilotApprovalRequest = {
  /** Human-readable summary of the effect the application proposes. */
  description: string;
  /** The agent that requested the effect. */
  agentId: string;
  /** The thread that requested the effect. */
  threadId: string;
  /** Render in a tool's generative UI card instead of the chat's default card. */
  presentation?: "chat" | "tool";
  /** Tool call that owns a tool-presented decision. */
  toolCallId?: string;
};

export type CopilotApprovalDecision = "approved" | "declined" | "cancelled";

export type CopilotApprovalResponse = {
  request: CopilotApprovalRequest;
  respond: (
    event: Event | { nativeEvent: Event },
    approved: boolean,
  ) => boolean;
};

/** Public, structural contract shared by the built-in chat and headless entry. */
export interface CopilotApprovalStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CopilotApprovalRequest | undefined;
  getWorkSnapshot(): CopilotApprovalRequest | undefined;
  respond(event: Event | { nativeEvent: Event }, approved: boolean): boolean;
  cancel(): void;
}

/**
 * A single pending, human-owned decision. Applications provide the review text
 * and retain responsibility for validation and execution after approval.
 */
export class CopilotApprovalController implements CopilotApprovalStore {
  private approvalSequence = 0;
  private traceId?: string;
  private pending?: CopilotApprovalRequest;
  private accepted?: CopilotApprovalRequest;
  private resolve?: (decision: CopilotApprovalDecision) => void;
  private signal?: AbortSignal;
  private listeners = new Set<() => void>();
  private onAbort = () => this.cancel();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CopilotApprovalRequest | undefined => this.pending;
  getWorkSnapshot = (): CopilotApprovalRequest | undefined =>
    this.pending ?? this.accepted;

  request(
    request: CopilotApprovalRequest,
    signal?: AbortSignal,
  ): Promise<CopilotApprovalDecision> {
    if (this.pending || this.accepted)
      throw new Error("Another approval is pending");
    if (signal?.aborted) return Promise.resolve("cancelled");
    this.pending = { ...request };
    this.traceId = `approval:${request.threadId}:${++this.approvalSequence}`;
    recordAutopilotToolTrace({
      id: this.traceId,
      agentId: request.agentId,
      threadId: request.threadId,
      toolName: "CopilotKit approval",
      phase: "started",
    });
    this.signal = signal;
    signal?.addEventListener("abort", this.onAbort, { once: true });
    const result = new Promise<CopilotApprovalDecision>((resolve) => {
      this.resolve = resolve;
    });
    this.emit();
    if (signal?.aborted) this.cancel();
    return result;
  }

  /** A programmatic event cannot approve an effect on the user's behalf. */
  respond(event: Event | { nativeEvent: Event }, approved: boolean): boolean {
    if (!this.pending) return false;
    const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
    if (
      typeof Event === "undefined" ||
      !(nativeEvent instanceof Event) ||
      !nativeEvent.isTrusted
    )
      return false;
    if (approved) {
      this.traceApproval("approved");
      this.accepted = this.pending;
      this.pending = undefined;
      const resolve = this.resolve;
      this.resolve = undefined;
      this.emit();
      resolve?.("approved");
    } else {
      this.finish("declined");
    }
    return true;
  }

  cancel(): void {
    if (this.pending) this.finish("cancelled");
    else if (this.accepted) this.finish("cancelled");
  }

  private finish(decision: CopilotApprovalDecision): void {
    this.traceApproval(decision);
    this.signal?.removeEventListener("abort", this.onAbort);
    this.signal = undefined;
    this.pending = undefined;
    this.accepted = undefined;
    const resolve = this.resolve;
    this.resolve = undefined;
    this.emit();
    resolve?.(decision);
  }

  private traceApproval(decision: CopilotApprovalDecision): void {
    const request = this.pending ?? this.accepted;
    if (!request || !this.traceId) return;
    recordAutopilotToolTrace({
      id: this.traceId,
      agentId: request.agentId,
      threadId: request.threadId,
      toolName: "CopilotKit approval",
      phase: "finished",
      result: JSON.stringify({ status: decision }),
    });
    this.traceId = undefined;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const emptySubscribe = () => () => {};
const emptySnapshot = () => undefined;

/** Headless state for rendering approvals outside the default chat surface. */
export function useCopilotApproval(
  controller?: CopilotApprovalStore,
): CopilotApprovalResponse | undefined {
  const request = useSyncExternalStore(
    controller?.subscribe ?? emptySubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  if (!request || !controller) return undefined;
  return {
    request,
    respond: (event, approved) => controller.respond(event, approved),
  };
}

/** Pending or already accepted work, for Stop controls that stay available until settlement. */
export function useCopilotApprovalWork(
  controller?: CopilotApprovalStore,
): CopilotApprovalRequest | undefined {
  return useSyncExternalStore(
    controller?.subscribe ?? emptySubscribe,
    controller?.getWorkSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
}
