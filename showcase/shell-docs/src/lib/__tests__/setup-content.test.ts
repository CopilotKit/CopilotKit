import setupContentData from "../../data/setup-content.json";
import { describe, expect, it } from "vitest";
import { resolveBundledSetupConcept, setupContentKey } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";

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
  // Google Antigravity's three setup snippets each carry a `<DemoCode>` reference
  // into the package's own agent sources, and `subagents-setup` reads the OUTER of
  // two nested regions. A published body must show neither the tag nor the inner
  // region's markers: the tag means the bundler could not resolve the file, and a
  // stray `@region[...]` line means a reader is copying build metadata out of a
  // snippet.
  it("bundles the Google Antigravity backend wiring its docs pages embed", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const source = (concept: string) => {
      const bundled = resolveBundledSetupConcept(
        "google-antigravity",
        concept,
        setupContent,
      );
      expect(bundled, concept).toBeTypeOf("string");
      expect(bundled, `${concept}: unresolved DemoCode`).not.toContain(
        "<DemoCode",
      );
      expect(bundled, `${concept}: leaked region marker`).not.toContain(
        "@region[",
      );
      return bundled ?? "";
    };

    // The supervisor's three delegation tools, from the region nested inside
    // `subagent-setup`.
    expect(source("subagents-setup")).toContain("async def research_agent");
    // The frontend tool the HITL demo's agent is told to call.
    expect(source("human-in-the-loop-setup")).toContain("book_call");
    // The mount, not just the agent construction.
    expect(source("agent-setup")).toContain("create_antigravity_app");
  });

  // The OpenAI Agents SDK snippets embed every concept's code from the
  // package's own agent sources, including two subclasses of the adapter's
  // agent (the resume payload and the document streaming).
  it("bundles the OpenAI Agents SDK backend wiring its docs pages embed", () => {
    const setupContent = setupContentData as SetupContentBundle;
    const source = (concept: string) => {
      const bundled = resolveBundledSetupConcept(
        "openai-agents-python",
        concept,
        setupContent,
      );
      expect(bundled, concept).toBeTypeOf("string");
      expect(bundled, `${concept}: unresolved DemoCode`).not.toContain(
        "<DemoCode",
      );
      expect(bundled, `${concept}: leaked region marker`).not.toContain(
        "@region[",
      );
      return bundled ?? "";
    };

    // The mount, not just the agent construction.
    expect(source("agent-setup")).toContain(
      "add_openai_agents_fastapi_endpoint",
    );
    // The approval-gated tool and the subclass that hands it the picked time.
    expect(source("human-in-the-loop-setup")).toContain(
      "@function_tool(needs_approval=True)",
    );
    expect(source("human-in-the-loop-setup")).toContain(
      "class SchedulerAgent(OpenAIAgentsAgent)",
    );
    // The state helper the read agents' dynamic instructions are built with.
    expect(source("shared-state-setup")).toContain("def with_state");
    // The subclass that turns argument chunks into state deltas.
    expect(source("state-streaming-setup")).toContain(
      "class DocumentStreamingAgent(OpenAIAgentsAgent)",
    );
    // The supervisor's delegation tools, from the region nested inside
    // `subagent-setup`.
    expect(source("subagents-setup")).toContain("async def research_agent");
  });
});
