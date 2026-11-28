// The agent frameworks a reader can bring (AGENT_FRAMEWORKS in shell-docs'
// src/proto/data.ts), which the early-access channel pages list as chips:
// one entry per framework, a family in several languages once.
import { describe, expect, test, vi } from "vitest";

// data.ts and live-scope.ts import through shell-docs' `@/` alias, which this
// package doesn't resolve. The registry here hides LangGraph's default
// variant (Python) and keeps its TypeScript one.
vi.mock("@/data/docs-modes.json", () => ({
  default: {
    mastra: "generated",
    "langgraph-python": "hidden",
    "langgraph-typescript": "generated",
    "built-in-agent": "generated",
  },
}));
vi.mock(
  "@/lib/frontends",
  () => import("../../../shell-docs/src/lib/frontends"),
);
vi.mock(
  "@/lib/live-scope",
  () => import("../../../shell-docs/src/lib/live-scope"),
);

import { AGENT_FRAMEWORKS } from "../../../shell-docs/src/proto/data";

describe("the agent frameworks a reader can bring", () => {
  test("a family whose default variant is hidden still shows, once", () => {
    const langgraph = AGENT_FRAMEWORKS.filter((f) => f.name === "LangGraph");
    expect(langgraph).toEqual([
      { id: "langgraph-typescript", name: "LangGraph" },
    ]);
  });

  test("CopilotKit's own built-in agent is left out", () => {
    expect(AGENT_FRAMEWORKS.map((f) => f.id)).not.toContain("built-in-agent");
    expect(AGENT_FRAMEWORKS.map((f) => f.id)).toContain("mastra");
  });
});
