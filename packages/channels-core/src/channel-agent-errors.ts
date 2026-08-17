export class ChannelDuplicateDefaultError extends Error {
  readonly code = "channel_duplicate_default";

  constructor() {
    super("Both `agent` and `agents.default` were set.");
    this.name = "ChannelDuplicateDefaultError";
  }
}

export class ChannelInvalidAgentIdError extends Error {
  readonly code = "channel_invalid_agent_id";
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Invalid Channel agent id "${agentId}".`);
    this.name = "ChannelInvalidAgentIdError";
    this.agentId = agentId;
  }
}

export class ChannelUnknownAgentError extends Error {
  readonly code = "channel_unknown_agent";
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Unknown Channel agent "${agentId}".`);
    this.name = "ChannelUnknownAgentError";
    this.agentId = agentId;
  }
}

export class ChannelNoDefaultAgentError extends Error {
  readonly code = "channel_no_default_agent";

  constructor() {
    super("No default agent is configured.");
    this.name = "ChannelNoDefaultAgentError";
  }
}

export class ChannelAgentInterruptPendingError extends Error {
  readonly code = "channel_agent_interrupt_pending";
  readonly agentId: string;

  constructor(agentId: string) {
    super(`Channel agent "${agentId}" is waiting on an interrupt.`);
    this.name = "ChannelAgentInterruptPendingError";
    this.agentId = agentId;
  }
}

export class ChannelAgentResumeNoneError extends Error {
  readonly code = "channel_agent_resume_none";
  readonly agentId?: string;

  constructor(agentId?: string) {
    super(
      agentId === undefined
        ? "No Channel agent is waiting for a resume."
        : `Channel agent "${agentId}" is not waiting for a resume.`,
    );
    this.name = "ChannelAgentResumeNoneError";
    this.agentId = agentId;
  }
}

export class ChannelAgentResumeAmbiguousError extends Error {
  readonly code = "channel_agent_resume_ambiguous";
  readonly waiters: string[];

  constructor(waiters: string[]) {
    super(
      `Multiple Channel agents are waiting for a resume: ${waiters.join(", ")}.`,
    );
    this.name = "ChannelAgentResumeAmbiguousError";
    this.waiters = waiters;
  }
}
