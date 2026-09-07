import { describe, expect, it } from "vitest";

import { onboardingFrontendFor } from "../docs-onboarding-frontend";
import { frontendPromptSuffix } from "../intelligence-onboarding-frontend";

describe("onboardingFrontendFor", () => {
  it.each([
    ["/vue/generative-ui", "vue", "Vue"],
    ["/angular/mastra", "angular", "Angular"],
    ["/react-spa", "react-spa", "React SPA"],
    ["/react-native/quickstart", "react-native", "React Native"],
    ["/slack/connect", "slack", "Slack"],
    ["/teams", "teams", "Teams"],
  ])("reads %s as the %s frontend", (pathname, id, name) => {
    expect(onboardingFrontendFor(pathname)).toEqual({ id, name });
  });

  it.each([
    ["", "the root surface"],
    ["/", "the docs home"],
    ["/quickstart", "an unprefixed page"],
    ["/mastra/generative-ui", "a backend-scoped page"],
    ["/cookbook/human-in-the-loop", "the cookbook"],
  ])("reads %s (%s) as the default React frontend", (pathname) => {
    expect(onboardingFrontendFor(pathname)).toEqual({
      id: "react",
      name: "React",
    });
  });

  it("applies the same rule the frontend selector applies", () => {
    // `FrameworkSelector` computes `urlFrontend ?? "react"`. Choosing another
    // frontend navigates to another URL, so the URL is what asserts the
    // selection — not a stored preference, which can disagree with the page
    // the reader is actually looking at.
    expect(onboardingFrontendFor("/vue").id).toBe("vue");
    expect(onboardingFrontendFor("/not-a-frontend").id).toBe("react");
  });

  it("hands the prompt a name and id that compose into the sentence", () => {
    const { id, name } = onboardingFrontendFor("/quickstart");
    expect(frontendPromptSuffix(id, name)).toBe(
      " The developer selected the React frontend (`nextjs`).",
    );
  });
});
