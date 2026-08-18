import { describe, expect, it } from "vitest";
import { siblingAgentRunUrl } from "./agents.js";

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
