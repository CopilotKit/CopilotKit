import { describe, expect, it } from "vitest";
import {
  frontendPromptSuffix,
  onboardingFrontendSlug,
} from "../intelligence-onboarding-frontend";

/**
 * Docs frontends with no graph equivalent. Keeping the list here means adding
 * a frontend the graph does not know is a conscious edit, not an accident.
 *
 * Slack and Teams are chat channels rather than application frontends. The
 * graph has no node for either, so naming one would promise a path the CLI
 * cannot walk.
 */
const DELIBERATELY_UNMAPPED = ["slack", "teams"];

describe("onboardingFrontendSlug", () => {
  it("maps the docs' default React frontend to the graph's `nextjs`", () => {
    // Not a guess: each graph frontend prompt under
    // `apps/cli/onboarding-prompts/frontend/` names the docs page it belongs
    // to, and `nextjs.md` is the only one pointing at the UNPREFIXED
    // `https://docs.copilotkit.ai/quickstart.md` — the docs' `react` frontend.
    // Every other prompt points at its own prefixed page.
    expect(onboardingFrontendSlug("react")).toBe("nextjs");
  });

  it.each([
    ["react-spa", "react-spa"],
    ["vue", "vue"],
    ["angular", "angular"],
    ["react-native", "react-native"],
  ])("passes through %s, which both sides spell the same", (docsId, slug) => {
    expect(onboardingFrontendSlug(docsId)).toBe(slug);
  });

  it.each(DELIBERATELY_UNMAPPED)(
    "leaves %s unmapped so the prompt promises nothing the CLI cannot do",
    (docsId) => {
      expect(onboardingFrontendSlug(docsId)).toBeUndefined();
      expect(frontendPromptSuffix(docsId, "Some Frontend")).toBe("");
    },
  );

  it("returns undefined for an id in neither set instead of throwing", () => {
    expect(onboardingFrontendSlug("not-a-frontend")).toBeUndefined();
    expect(frontendPromptSuffix("not-a-frontend", "Not A Frontend")).toBe("");
  });
});
