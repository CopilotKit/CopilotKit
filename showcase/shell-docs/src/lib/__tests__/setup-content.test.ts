import { describe, expect, it } from "vitest";
import { resolveBundledSetupConcept, setupContentKey } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";
import setupContentData from "@/data/setup-content.json";

const bundle: SetupContentBundle = {
  version: 1,
  concepts: {
    "langgraph-python::agent-setup": {
      framework: "langgraph-python",
      concept: "agent-setup",
      source: "# LangGraph setup\n",
    },
  },
};

describe("setup content bundle", () => {
  it("uses framework and concept as the stable lookup key", () => {
    expect(setupContentKey("langgraph-python", "agent-setup")).toBe(
      "langgraph-python::agent-setup",
    );
  });

  it("returns the bundled source when the framework concept exists", () => {
    expect(
      resolveBundledSetupConcept("langgraph-python", "agent-setup", bundle),
    ).toBe("# LangGraph setup\n");
  });

  it("falls back from LangGraph FastAPI to the Python setup content", () => {
    expect(
      resolveBundledSetupConcept("langgraph-fastapi", "agent-setup", bundle),
    ).toBe("# LangGraph setup\n");
  });

  it("returns null when the framework concept is absent", () => {
    expect(
      resolveBundledSetupConcept("google-adk", "agent-setup", bundle),
    ).toBe(null);
    expect(
      resolveBundledSetupConcept("langgraph-python", "missing", bundle),
    ).toBe(null);
  });

  it("bundles non-empty Claude Agent SDK setup content for rendered quickstarts", () => {
    const setupContent = setupContentData as SetupContentBundle;

    for (const framework of ["claude-sdk-python", "claude-sdk-typescript"]) {
      const source = resolveBundledSetupConcept(
        framework,
        "agent-setup",
        setupContent,
      );

      expect(source, framework).toContain("ClaudeAgentAdapter");
      expect(source, framework).toMatch(/```|~~~/);
      expect(source, framework).not.toContain("<DemoCode");
    }
  });
});
