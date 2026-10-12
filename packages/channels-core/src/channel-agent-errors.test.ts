import { describe, expect, it } from "vitest";
import {
  ChannelAgentInterruptPendingError,
  ChannelAgentResumeAmbiguousError,
  ChannelAgentResumeNoneError,
  ChannelDuplicateDefaultError,
  ChannelInvalidAgentIdError,
  ChannelNoDefaultAgentError,
  ChannelUnknownAgentError,
} from "./channel-agent-errors.js";

describe("ChannelDuplicateDefaultError", () => {
  it("exposes a stable code and names both default sources", () => {
    const err = new ChannelDuplicateDefaultError();
    expect(err.code).toBe("channel_duplicate_default");
    expect(err.name).toBe("ChannelDuplicateDefaultError");
    expect(err.message).toContain("agent");
    expect(err.message).toContain("agents.default");
  });
});

describe("ChannelInvalidAgentIdError", () => {
  it("exposes a stable code and the bad id", () => {
    const err = new ChannelInvalidAgentIdError("bad id");
    expect(err.code).toBe("channel_invalid_agent_id");
    expect(err.name).toBe("ChannelInvalidAgentIdError");
    expect(err.agentId).toBe("bad id");
    expect(err.message).toContain("bad id");
  });
});

describe("ChannelUnknownAgentError", () => {
  it("exposes a stable code and the missing id", () => {
    const err = new ChannelUnknownAgentError("search");
    expect(err.code).toBe("channel_unknown_agent");
    expect(err.name).toBe("ChannelUnknownAgentError");
    expect(err.agentId).toBe("search");
    expect(err.message).toContain("search");
  });
});

describe("ChannelNoDefaultAgentError", () => {
  it("exposes a stable code and says no default is configured", () => {
    const err = new ChannelNoDefaultAgentError();
    expect(err.code).toBe("channel_no_default_agent");
    expect(err.name).toBe("ChannelNoDefaultAgentError");
    expect(err.message.toLowerCase()).toContain("no default");
  });
});

describe("ChannelAgentInterruptPendingError", () => {
  it("exposes a stable code and the waiting id", () => {
    const err = new ChannelAgentInterruptPendingError("writer");
    expect(err.code).toBe("channel_agent_interrupt_pending");
    expect(err.name).toBe("ChannelAgentInterruptPendingError");
    expect(err.agentId).toBe("writer");
    expect(err.message).toContain("writer");
  });
});

describe("ChannelAgentResumeNoneError", () => {
  it("exposes a stable code and names the id when given", () => {
    const err = new ChannelAgentResumeNoneError("search");
    expect(err.code).toBe("channel_agent_resume_none");
    expect(err.name).toBe("ChannelAgentResumeNoneError");
    expect(err.agentId).toBe("search");
    expect(err.message).toContain("search");
  });

  it("exposes a stable code and says no waiter when no id is given", () => {
    const err = new ChannelAgentResumeNoneError();
    expect(err.code).toBe("channel_agent_resume_none");
    expect(err.name).toBe("ChannelAgentResumeNoneError");
    expect(err.agentId).toBeUndefined();
    expect(err.message.toLowerCase()).toMatch(/no .*wait/);
  });
});

describe("ChannelAgentResumeAmbiguousError", () => {
  it("exposes a stable code and lists the waiting ids", () => {
    const err = new ChannelAgentResumeAmbiguousError(["search", "writer"]);
    expect(err.code).toBe("channel_agent_resume_ambiguous");
    expect(err.name).toBe("ChannelAgentResumeAmbiguousError");
    expect(err.waiters).toEqual(["search", "writer"]);
    expect(err.message).toContain("search");
    expect(err.message).toContain("writer");
  });
});
