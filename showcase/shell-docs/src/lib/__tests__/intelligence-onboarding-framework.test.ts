import { describe, expect, it } from "vitest";

import registryData from "@/data/registry.json";
import {
  frameworkPromptSuffix,
  onboardingFrameworkSlug,
} from "../intelligence-onboarding-framework";

/**
 * Docs slugs with no graph equivalent. Keeping the list here means adding an
 * integration the graph does not know is a conscious edit, not an accident.
 */
const DELIBERATELY_UNMAPPED = [
  "built-in-agent",
  "crewai-conversational-flows",
  "langroid",
  "spring-ai",
];

describe("onboardingFrameworkSlug", () => {
  it("renames the two docs slugs the graph spells differently", () => {
    expect(onboardingFrameworkSlug("crewai-crews")).toBe("crewai-flows");
    expect(onboardingFrameworkSlug("strands")).toBe("strands-python");
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
});

describe("docs registry coverage", () => {
  it("maps every integration slug or lists it as deliberately unmapped", () => {
    const undecided = registryData.integrations
      .map(({ slug }) => slug)
      .filter(
        (slug) =>
          onboardingFrameworkSlug(slug) === undefined &&
          !DELIBERATELY_UNMAPPED.includes(slug),
      );

    expect(undecided).toEqual([]);
  });
});
