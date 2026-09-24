export interface AutopilotApprovalTarget {
  userId: string;
  organizationId: string;
  recordId: string;
  version: number;
  action: string;
  path: string;
}

export interface AutopilotApprovalBinding {
  target: AutopilotApprovalTarget;
  tool: string;
  handlerVersion: string;
  normalizedArguments: string;
  agentId: string;
  threadId: string;
  requestId: string;
  toolCallId: string;
  controlRef: string;
}

export type AutopilotApprovalResult = {
  operationId: string;
  status: "completed" | "denied" | "cancelled" | "failed" | "uncertain";
  reason?: string;
  receipt?: { recordId: string; version: number; status: string };
};

type Pending = {
  binding: AutopilotApprovalBinding;
  id: string;
  state: "awaiting" | "rechecking" | "dispatched";
  expiresAt: number;
  recheck: () => Promise<boolean>;
  resolve: (value: AutopilotApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort: () => void;
};

export type AutopilotAppDecision =
  | { mode: "manual" }
  | { mode: "autopilot"; accepted: false }
  | { mode: "autopilot"; accepted: true; operationId: string };

/** Local, single-use approval for an app-owned effect and its existing UI confirmation. */
export class BrowserApprovalGate {
  private pending?: Pending;

  begin(
    binding: AutopilotApprovalBinding,
    recheck: () => Promise<boolean>,
    signal?: AbortSignal,
    ttlMs = 60_000,
  ): { operationId: string; result: Promise<AutopilotApprovalResult> } {
    if (this.pending)
      throw new Error("Another Autopilot action is awaiting a decision");
    if (signal?.aborted) throw new Error("Autopilot action was stopped");
    const operationId = crypto.randomUUID();
    let resolve!: (value: AutopilotApprovalResult) => void;
    const result = new Promise<AutopilotApprovalResult>((settle) => {
      resolve = settle;
    });
    const pending: Pending = {
      binding: structuredClone(binding),
      id: operationId,
      state: "awaiting",
      expiresAt: Date.now() + ttlMs,
      recheck,
      resolve,
      timer: setTimeout(
        () => this.settle(operationId, "cancelled", "Approval expired"),
        ttlMs,
      ),
      signal,
      onAbort: () => {
        if (this.pending?.state !== "dispatched")
          this.settle(operationId, "cancelled", "Action stopped");
      },
    };
    this.pending = pending;
    signal?.addEventListener("abort", pending.onAbort, { once: true });
    if (signal?.aborted) {
      pending.onAbort();
      throw new Error("Autopilot action was stopped");
    }
    return { operationId, result };
  }

  /** Called by the app after its real confirmation UI returns a human decision. */
  async decideFromApp(
    target: AutopilotApprovalTarget,
    approved: boolean,
    trustedManualEvent = false,
  ): Promise<AutopilotAppDecision> {
    const pending = this.pending;
    if (!pending)
      return trustedManualEvent
        ? { mode: "manual" }
        : { mode: "autopilot", accepted: false };
    if (pending.state !== "awaiting")
      return { mode: "autopilot", accepted: false };
    pending.state = "rechecking";
    if (JSON.stringify(target) !== JSON.stringify(pending.binding.target)) {
      this.settle(pending.id, "denied", "Action target changed");
      return { mode: "autopilot", accepted: false };
    }
    if (!approved) {
      this.settle(pending.id, "denied", "User declined");
      return { mode: "autopilot", accepted: false };
    }
    if (Date.now() >= pending.expiresAt || pending.signal?.aborted) {
      this.settle(
        pending.id,
        "cancelled",
        "Approval expired or action stopped",
      );
      return { mode: "autopilot", accepted: false };
    }
    try {
      if (
        !(await pending.recheck()) ||
        this.pending !== pending ||
        pending.signal?.aborted
      ) {
        this.settle(pending.id, "denied", "Action changed before dispatch");
        return { mode: "autopilot", accepted: false };
      }
    } catch {
      this.settle(pending.id, "denied", "Action could not be rechecked");
      return { mode: "autopilot", accepted: false };
    }
    pending.state = "dispatched";
    clearTimeout(pending.timer);
    return { mode: "autopilot", accepted: true, operationId: pending.id };
  }

  finish(
    operationId: string,
    outcome: Omit<AutopilotApprovalResult, "operationId">,
  ): void {
    const pending = this.pending;
    if (
      !pending ||
      pending.id !== operationId ||
      pending.state !== "dispatched"
    )
      return;
    this.settle(operationId, outcome.status, outcome.reason, outcome.receipt);
  }

  cancelAwaiting(reason = "Action cancelled"): void {
    if (
      this.pending?.state === "awaiting" ||
      this.pending?.state === "rechecking"
    ) {
      this.settle(this.pending.id, "cancelled", reason);
    }
  }

  private settle(
    operationId: string,
    status: AutopilotApprovalResult["status"],
    reason?: string,
    receipt?: AutopilotApprovalResult["receipt"],
  ): void {
    const pending = this.pending;
    if (!pending || pending.id !== operationId) return;
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.onAbort);
    this.pending = undefined;
    pending.resolve({ operationId, status, reason, receipt });
  }
}
