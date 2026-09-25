export type AutopilotBudgetKind = "action" | "read";

export interface AutopilotBudgetIdentity {
  userId: string;
  organizationId: string;
  agentId: string;
  threadId: string;
  requestId: string;
}

export interface AutopilotBudgetDecision {
  allowed: boolean;
  remaining: number;
  limit: number;
  reason?: string;
}

/** A browser-local budget keyed to one explicit user message, shared by follow-up runs and tabs. */
export class BrowserRequestBudget {
  constructor(
    private readonly actionLimit = 8,
    private readonly readLimit = 12,
  ) {}

  async consume(
    identity: AutopilotBudgetIdentity,
    kind: AutopilotBudgetKind,
  ): Promise<AutopilotBudgetDecision> {
    if (Object.values(identity).some((value) => !value))
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        reason: "Request identity is unavailable",
      };
    const limit = kind === "action" ? this.actionLimit : this.readLimit;
    const key = `copilotkit:autopilot:budget:${JSON.stringify([identity, kind])}`;
    if (!navigator.locks || !window.localStorage)
      return {
        allowed: false,
        remaining: 0,
        limit,
        reason: "Request coordination is unavailable",
      };
    try {
      return await navigator.locks.request(key, async () => {
        const previous = Number(window.localStorage.getItem(key) ?? "0");
        if (!Number.isInteger(previous) || previous < 0)
          return {
            allowed: false,
            remaining: 0,
            limit,
            reason: "Request budget state is invalid",
          };
        if (previous >= limit)
          return {
            allowed: false,
            remaining: 0,
            limit,
            reason: `Request ${kind} limit reached; send a new message to continue`,
          };
        const next = previous + 1;
        window.localStorage.setItem(key, String(next));
        return { allowed: true, remaining: limit - next, limit };
      });
    } catch {
      return {
        allowed: false,
        remaining: 0,
        limit,
        reason: "Request budget could not be saved",
      };
    }
  }
}
