import { describe, it, expect } from "vitest";
import { listUnreadyFrameworks } from "./audit-docs-porting.js";

describe("listUnreadyFrameworks", () => {
  it("excludes the ready slugs and includes known unready ones", () => {
    const result = listUnreadyFrameworks();
    expect(result).not.toContain("langgraph-python");
    expect(result).not.toContain("langgraph-typescript");
    expect(result).not.toContain("google-adk");
    expect(result).toContain("mastra");
    expect(result).toContain("pydantic-ai");
    expect(result).toContain("ms-agent-dotnet");
  });
});
