import { describe, expect, it } from "vitest";

import { createIntelligenceOnboardingPrompt } from "@/lib/intelligence-onboarding-prompt";
import { composeWizardOnboardingPrompt } from "../wizard-onboarding-prompt";
import type { WizardPromptSelection } from "../wizard-onboarding-prompt";

const RUN_ID = "test-run-id";

const NO_SELECTION: WizardPromptSelection = {
  backend: null,
  frontend: null,
  featureTitles: [],
  project: null,
};

describe("composeWizardOnboardingPrompt", () => {
  it("equals the canonical prompt when nothing is selected", () => {
    expect(composeWizardOnboardingPrompt(RUN_ID, NO_SELECTION)).toBe(
      createIntelligenceOnboardingPrompt(RUN_ID),
    );
  });

  it("orders the framework sentence before the frontend sentence", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: { id: "mastra", name: "Mastra" },
      frontend: { id: "vue", name: "Vue" },
      featureTitles: [],
      project: null,
    });

    const frameworkIndex = result.indexOf("agent framework");
    const frontendIndex = result.indexOf("frontend");

    expect(frameworkIndex).toBeGreaterThan(-1);
    expect(frontendIndex).toBeGreaterThan(-1);
    expect(frameworkIndex).toBeLessThan(frontendIndex);
  });

  it("contributes nothing for a docs slug the graph does not know", () => {
    // Confirmed by reading `intelligence-onboarding-framework.ts`:
    // `spring-ai` is neither in `ONBOARDING_AGENT_FRAMEWORKS` nor a key of
    // `DOCS_SLUG_RENAMES`, so it is genuinely absent from the graph's set.
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: { id: "spring-ai", name: "Spring AI" },
      frontend: null,
      featureTitles: [],
      project: null,
    });

    expect(result).toBe(createIntelligenceOnboardingPrompt(RUN_ID));
  });

  it("translates the react frontend docs id to the graph's nextjs slug", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: null,
      frontend: { id: "react", name: "React" },
      featureTitles: [],
      project: null,
    });

    expect(result).toContain("`nextjs`");
  });

  it("translates the built-in-agent docs slug to the graph's built-in slug", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: { id: "built-in-agent", name: "Built-in" },
      frontend: null,
      featureTitles: [],
      project: null,
    });

    expect(result).toContain("`built-in`");
  });

  it("omits the features sentence for an empty list", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, NO_SELECTION);

    expect(result).not.toContain("CopilotKit features");
  });

  it("lists feature titles comma-separated when present", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: null,
      frontend: null,
      featureTitles: ["Human in the Loop", "Generative UI"],
      project: null,
    });

    expect(result).toContain(
      " They also want these CopilotKit features set up: Human in the Loop, Generative UI.",
    );
  });

  it("includes the existing-project sentence when project is yes", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: null,
      frontend: null,
      featureTitles: [],
      project: "yes",
    });

    expect(result).toContain(
      " They already have an existing project and want CopilotKit added to it.",
    );
  });

  it("includes the brand-new-project sentence when project is no", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: null,
      frontend: null,
      featureTitles: [],
      project: "no",
    });

    expect(result).toContain(" They are starting a brand new project.");
  });

  it("omits the project sentence entirely when unanswered", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, NO_SELECTION);

    expect(result).not.toContain("existing project");
    expect(result).not.toContain("brand new project");
  });

  it("keeps the coding-agent CLI flag literal and resolves the run-id placeholder", () => {
    const result = composeWizardOnboardingPrompt(RUN_ID, {
      backend: { id: "mastra", name: "Mastra" },
      frontend: { id: "vue", name: "Vue" },
      featureTitles: ["Human in the Loop"],
      project: null,
    });

    // The exact placeholder spelling, per `intelligence-onboarding-prompt.ts`.
    expect(result).not.toContain("<run-id>");
    expect(result).toContain("--coding-agent <coding-agent-slug>");
    expect(result).toContain(RUN_ID);
  });
});
