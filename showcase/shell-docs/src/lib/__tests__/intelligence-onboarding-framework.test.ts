import { describe, expect, it } from "vitest";

import { getIntegrations } from "@/lib/registry";
import {
  frameworkPromptSuffix,
  onboardingFrameworkSlug,
} from "../intelligence-onboarding-framework";

/**
 * Docs slugs with no graph equivalent. Keeping the list here means adding an
 * integration the graph does not know is a conscious edit, not an accident.
 */
const DELIBERATELY_UNMAPPED = [
  "crewai-conversational-flows",
  "langroid",
  "spring-ai",
];

describe("onboardingFrameworkSlug", () => {
  it("renames the docs slugs the graph spells differently", () => {
    expect(onboardingFrameworkSlug("crewai-crews")).toBe("crewai-flows");
    expect(onboardingFrameworkSlug("strands")).toBe("strands-python");
  });

  it("maps the Built-in Agent's docs slug to the graph's `built-in`", () => {
    // The graph does know this framework: `ONBOARDING_AGENT_FRAMEWORKS` in
    // the Intelligence repo lists `built-in`, and the graph ships
    // `onboarding-prompts/framework/built-in.md`. Only the spelling differs.
    expect(onboardingFrameworkSlug("built-in-agent")).toBe("built-in");
  });

  it("maps the Deep Agents docs slug to the graph's `deep-agents`", () => {
    // Docs-only integration, so it is absent from the registry JSON but
    // present in `getIntegrations()`. The graph ships
    // `onboarding-prompts/framework/deep-agents.md`; only the spelling differs.
    expect(onboardingFrameworkSlug("deepagents")).toBe("deep-agents");
  });

  it("passes through a slug both sides already agree on", () => {
    expect(onboardingFrameworkSlug("mastra")).toBe("mastra");
  });

  it.each(DELIBERATELY_UNMAPPED)(
    "leaves %s unmapped so the prompt promises nothing the CLI cannot do",
    (docsSlug) => {
      expect(onboardingFrameworkSlug(docsSlug)).toBeUndefined();
      expect(frameworkPromptSuffix(docsSlug, "Some Framework")).toBe("");
    },
  );

  it("returns undefined for a slug in neither set instead of throwing", () => {
    expect(onboardingFrameworkSlug("not-a-framework")).toBeUndefined();
    expect(frameworkPromptSuffix("not-a-framework", "Not A Framework")).toBe(
      "",
    );
  });
});

describe("frameworkPromptSuffix", () => {
  it("appends the exact sentence the CLI graph reads", () => {
    expect(frameworkPromptSuffix("mastra", "Mastra")).toBe(
      " The developer selected the Mastra agent framework (`mastra`).",
    );
  });

  it("reads as English for the Built-in Agent's call-site display name", () => {
    // The registry name is "CopilotKit's Built-in Agent", which this template
    // would render as "the CopilotKit's Built-in Agent agent framework".
    // `onboardingFrameworkFor` passes the trimmed name instead — assert the
    // whole sentence so a regression in either half is caught here. The name
    // stops at "Built-in" because the template already supplies "agent".
    expect(frameworkPromptSuffix("built-in-agent", "Built-in")).toBe(
      " The developer selected the Built-in agent framework (`built-in`).",
    );
  });
});

describe("docs registry coverage", () => {
  it("maps every integration slug or lists it as deliberately unmapped", () => {
    // `getIntegrations()`, not the raw registry JSON: docs-only integrations
    // (today `deepagents`) are merged in by `registry.ts` and never appear in
    // the JSON. Reading the file directly left this guard blind to exactly the
    // slugs most likely to be forgotten — `deepagents` reached main unmapped.
    const undecided = getIntegrations()
      .map(({ slug }) => slug)
      .filter(
        (slug) =>
          onboardingFrameworkSlug(slug) === undefined &&
          !DELIBERATELY_UNMAPPED.includes(slug),
      );

    expect(undecided).toEqual([]);
  });
});
