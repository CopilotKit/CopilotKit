import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
  getAgentContextWarnThreshold,
  resetAgentContextWarnState,
  warnIfAssembledAgentContextOversized,
} from "../agent-context-size";

describe("getAgentContextWarnThreshold", () => {
  const originalThreshold = process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
    } else {
      process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = originalThreshold;
    }
  });

  it("uses the default when the env value is unset, empty, or whitespace", () => {
    delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
    expect(getAgentContextWarnThreshold()).toBe(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
    );
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "";
    expect(getAgentContextWarnThreshold()).toBe(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
    );
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "  ";
    expect(getAgentContextWarnThreshold()).toBe(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
    );
  });

  it("rejects partially parsed or malformed values and falls back to the default", () => {
    for (const bad of ["100abc", "1.5", "-1oops", "abc", "12px", "-2", "--1"]) {
      process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = bad;
      expect(getAgentContextWarnThreshold()).toBe(
        DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
      );
    }
  });

  it("accepts a complete non-negative integer and the -1 disable sentinel", () => {
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "10";
    expect(getAgentContextWarnThreshold()).toBe(10);
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "0";
    expect(getAgentContextWarnThreshold()).toBe(0);
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "-1";
    expect(getAgentContextWarnThreshold()).toBe(-1);
  });
});

describe("warnIfAssembledAgentContextOversized", () => {
  const originalThreshold = process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resetAgentContextWarnState();
    delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalThreshold === undefined) {
      delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
    } else {
      process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = originalThreshold;
    }
  });

  it("warns as soon as the assembled size exceeds the default threshold", () => {
    warnIfAssembledAgentContextOversized(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD + 1,
      "builtIn",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the assembled size is within the threshold", () => {
    warnIfAssembledAgentContextOversized(10, "builtIn");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns only once per call-site variant, even across repeated turns", () => {
    warnIfAssembledAgentContextOversized(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD + 1,
      "builtIn",
    );
    warnIfAssembledAgentContextOversized(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD + 1,
      "builtIn",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.mocked(console.warn).mockClear();
    warnIfAssembledAgentContextOversized(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD + 1,
      "tanstack",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("honours an env-overridable threshold and disables with -1", () => {
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "10";
    warnIfAssembledAgentContextOversized(50, "tanstack");
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.mocked(console.warn).mockClear();
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "-1";
    warnIfAssembledAgentContextOversized(50, "tanstack");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns on any non-empty prompt when the threshold is 0", () => {
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "0";
    warnIfAssembledAgentContextOversized(1, "builtIn");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
