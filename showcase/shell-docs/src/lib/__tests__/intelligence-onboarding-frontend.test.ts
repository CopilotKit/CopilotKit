import { describe, expect, it } from "vitest";

import { FRONTEND_OPTIONS } from "@/lib/frontend-options";
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

describe("frontendPromptSuffix", () => {
  it("appends the exact sentence the CLI graph reads", () => {
    expect(frontendPromptSuffix("vue", "Vue")).toBe(
      " The developer selected the Vue frontend (`vue`).",
    );
  });

  it("pairs the docs display name with the graph slug for React", () => {
    // The one pair where the two names differ. The docs call this frontend
    // React and the graph calls it `nextjs`; the sentence says both, exactly
    // as the framework sentence pairs a display name with a graph slug.
    expect(frontendPromptSuffix("react", "React")).toBe(
      " The developer selected the React frontend (`nextjs`).",
    );
  });

  it.each([
    [
      "react-spa",
      "React SPA",
      " The developer selected the React SPA frontend (`react-spa`).",
    ],
    [
      "angular",
      "Angular",
      " The developer selected the Angular frontend (`angular`).",
    ],
    [
      "react-native",
      "React Native",
      " The developer selected the React Native frontend (`react-native`).",
    ],
  ])("renders the whole sentence for %s", (docsId, name, sentence) => {
    expect(frontendPromptSuffix(docsId, name)).toBe(sentence);
  });
});

describe("docs frontend registry coverage", () => {
  it("maps every docs frontend or lists it as deliberately unmapped", () => {
    // `FRONTEND_OPTIONS`, the same list the selector and every route read, so
    // this guard cannot go blind to an entry the app does show. Adding a
    // frontend to the registry without deciding what the prompt says about it
    // fails here rather than silently producing no sentence.
    const undecided = FRONTEND_OPTIONS.map(({ id }) => id).filter(
      (id) =>
        onboardingFrontendSlug(id) === undefined &&
        !DELIBERATELY_UNMAPPED.includes(id),
    );

    expect(undecided).toEqual([]);
  });

  it("lists nothing as deliberately unmapped that is not a docs frontend", () => {
    // The other direction: a frontend removed from the registry must not leave
    // a stale entry here propping the guard above up.
    const ids = FRONTEND_OPTIONS.map(({ id }) => String(id));
    expect(DELIBERATELY_UNMAPPED.filter((id) => !ids.includes(id))).toEqual([]);
  });
});
