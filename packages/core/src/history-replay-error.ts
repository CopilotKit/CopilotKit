/** Terminal history restore failure; `reason` is a gateway or SDK recovery code. */
export class AgentHistoryReplayError extends Error {
  constructor(public readonly reason: string) {
    super(`Thread history replay failed: ${reason}`);
    this.name = "AgentHistoryReplayError";
  }
}
