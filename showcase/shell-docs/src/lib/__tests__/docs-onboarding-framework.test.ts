import { describe, expect, it } from "vitest";

import { onboardingFrameworkFor } from "../docs-onboarding-framework";

describe("onboardingFrameworkFor", () => {
  it("trims the possessive out of the Built-in Agent's registry name", () => {
    // The registry calls it "CopilotKit's Built-in Agent", which the shared
    // prompt sentence would render as "the CopilotKit's Built-in Agent agent
    // framework". The override lives here, at the one call site both the
    // framework route and the root surface go through.
    expect(onboardingFrameworkFor("built-in-agent")).toEqual({
      slug: "built-in-agent",
      name: "Built-in Agent",
    });
  });

  it("passes the registry name through for every other framework", () => {
    expect(onboardingFrameworkFor("mastra")).toEqual({
      slug: "mastra",
      name: "Mastra",
    });
    expect(onboardingFrameworkFor("langgraph-python")).toEqual({
      slug: "langgraph-python",
      name: "LangGraph (Python)",
    });
  });

  it("returns undefined for a slug with no registry record", () => {
    // Docs-only slugs (`a2a`, `agent-spec`) have docs but no integration
    // package, so there is no name to put in the prompt. No name, no button.
    expect(onboardingFrameworkFor("a2a")).toBeUndefined();
  });

  it("returns undefined when no framework is selected at all", () => {
    expect(onboardingFrameworkFor(null)).toBeUndefined();
    expect(onboardingFrameworkFor(undefined)).toBeUndefined();
    expect(onboardingFrameworkFor("")).toBeUndefined();
  });
});
