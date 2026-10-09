import type { ɵThread } from "@copilotkit/core";
import { describe, expect, it } from "vitest";
import { selectActiveThreads } from "./selectors.js";

function thread(id: string, agentId: string): ɵThread {
  return {
    id,
    agentId,
    name: id,
    organizationId: "organization",
    createdById: "user",
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("selectActiveThreads", () => {
  it("selects all agents or the active agent without duplicating thread ids", () => {
    const alpha = thread("shared", "alpha");
    const beta = thread("beta-only", "beta");
    const byAgent = new Map([
      ["alpha", [alpha]],
      ["beta", [alpha, beta]],
    ]);

    expect(
      selectActiveThreads(byAgent, "all-agents").map(({ id }) => id),
    ).toEqual(["shared", "beta-only"]);
    expect(selectActiveThreads(byAgent, "beta")).toEqual([alpha, beta]);
  });
});
