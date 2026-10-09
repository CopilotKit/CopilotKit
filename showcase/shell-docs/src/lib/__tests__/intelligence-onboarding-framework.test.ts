import { describe, expect, it } from "vitest";
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
  // The onboarding graph has no Antigravity entry yet; the docs promise
  // nothing until `ONBOARDING_AGENT_FRAMEWORKS` in the Intelligence repo
  // gains one. Its CLI framework id will be `antigravity` when it does.
  "google-antigravity",
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
