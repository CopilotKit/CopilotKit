import { describe, expect, it } from "vitest";

import { readDelegations, readSteps } from "./agent-state-model";

describe("Angular agent-state demo models", () => {
  it("reads valid planning steps without retaining malformed entries", () => {
    expect(
      readSteps({
        steps: [
          { id: "one", title: "Research launch channels", status: "pending" },
          { id: "two", title: 42, status: "completed" },
          { id: "three", title: "Draft launch brief", status: "unknown" },
        ],
      }),
    ).toEqual([
      { id: "one", title: "Research launch channels", status: "pending" },
    ]);
  });

  it("reads completed supervisor delegations and rejects unknown roles", () => {
    expect(
      readDelegations({
        delegations: [
          {
            id: "research-1",
            sub_agent: "research_agent",
            task: "Find remote-work evidence",
            status: "completed",
            result: "Remote work improves flexibility.",
          },
          {
            id: "unknown-1",
            sub_agent: "unknown_agent",
            task: "Do something",
            status: "completed",
            result: "Done",
          },
        ],
      }),
    ).toEqual([
      {
        id: "research-1",
        subAgent: "research_agent",
        task: "Find remote-work evidence",
        status: "completed",
        result: "Remote work improves flexibility.",
      },
    ]);
  });

  it("returns empty collections for malformed state", () => {
    expect(readSteps({ steps: "not-an-array" })).toEqual([]);
    expect(readDelegations(null)).toEqual([]);
  });
});
