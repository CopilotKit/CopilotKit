import { describe, expect, it } from "vitest";
import { parseNamedAgentPrompt, siblingAgentRunUrl } from "./agents.js";

describe("siblingAgentRunUrl", () => {
  it("swaps the agent id on a standard AG-UI run URL", () => {
    expect(
      siblingAgentRunUrl(
        "http://localhost:8200/api/copilotkit/agent/triage/run",
        "search",
      ),
    ).toBe("http://localhost:8200/api/copilotkit/agent/search/run");
  });

  it("drops a trailing slash before swapping", () => {
    expect(
      siblingAgentRunUrl(
        "http://localhost:8200/api/copilotkit/agent/triage/run/",
        "search",
      ),
    ).toBe("http://localhost:8200/api/copilotkit/agent/search/run");
  });

  it("appends the standard run path when AGENT_URL is the runtime base", () => {
    expect(
      siblingAgentRunUrl("http://localhost:8200/api/copilotkit", "search"),
    ).toBe("http://localhost:8200/api/copilotkit/agent/search/run");
  });
});

describe("parseNamedAgentPrompt", () => {
  it("selects search from a search: prefix", () => {
    expect(parseNamedAgentPrompt("search: open CPK issues")).toEqual({
      agentId: "search",
      prompt: "open CPK issues",
    });
  });

  it("selects search from a leading search word", () => {
    expect(parseNamedAgentPrompt("search open CPK issues")).toEqual({
      agentId: "search",
      prompt: "open CPK issues",
    });
  });

  it("strips a Slack mention token before the prefix", () => {
    expect(parseNamedAgentPrompt("<@U123> search: cycle 12")).toEqual({
      agentId: "search",
      prompt: "cycle 12",
    });
  });

  it("leaves ordinary triage text on the default agent", () => {
    expect(parseNamedAgentPrompt("triage my open issues")).toEqual({
      agentId: undefined,
      prompt: "triage my open issues",
    });
  });
});
