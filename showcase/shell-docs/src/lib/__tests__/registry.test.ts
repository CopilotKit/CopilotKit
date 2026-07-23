import { describe, expect, it } from "vitest";

import { compareByDisplayOrder } from "../framework-order";
import { getDocsMode, getIntegration } from "../registry";

describe("docs mode registry", () => {
  it("treats Deep Agents as authored docs", () => {
    expect(getIntegration("deepagents")).toMatchObject({
      name: "Deep Agents",
      docs_mode: "authored",
    });
    expect(getDocsMode("deepagents")).toBe("authored");
  });

  it("puts Deep Agents above LangGraph and FastAPI under Python", () => {
    expect(
      compareByDisplayOrder("deepagents", "langgraph-python"),
    ).toBeLessThan(0);
    expect(
      compareByDisplayOrder("langgraph-python", "langgraph-fastapi"),
    ).toBeLessThan(0);
    expect(
      compareByDisplayOrder("langgraph-fastapi", "langgraph-typescript"),
    ).toBeLessThan(0);
  });
});
