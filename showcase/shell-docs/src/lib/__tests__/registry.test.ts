import { describe, expect, it } from "vitest";

import { getDocsMode, getIntegration } from "../registry";

describe("docs mode registry", () => {
  it("treats Deep Agents as authored docs", () => {
    expect(getIntegration("deepagents")?.docs_mode).toBe("authored");
    expect(getDocsMode("deepagents")).toBe("authored");
  });
});
