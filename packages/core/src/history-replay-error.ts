/** Terminal history restore failure; `reason` is the gateway's error code. */
export class AgentHistoryReplayError extends Error {
  constructor(public readonly reason: string) {
    super(`Thread history replay failed: ${reason}`);
    this.name = "AgentHistoryReplayError";
  }
}
