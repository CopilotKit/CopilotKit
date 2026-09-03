import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  openingTagAttributes,
  valuedPropPattern,
} from "@/test-utils/jsx-source";

/**
 * The MDX components map in `docs-page-view.tsx` is the render path for the
 * ten authored framework landing heroes (mastra, llamaindex, langgraph,
 * pydantic-ai, ag2, agno, aws-strands, crewai-flows, deepagents,
 * microsoft-agent-framework) and for every hand-placed
 * `<IntelligenceOnboardingPrompt />` banner. Neither component can work out
 * on its own which page it landed on, so the map's closures inject that
 * context.
 *
 * Every injected prop here is optional, so a closure that forgets one still
 * compiles and still renders — the prompt just silently loses its frontend
 * and its page sentence. Asserted on the source because these render sites
 * sit inside a large async server component whose dependencies (MDX
 * compilation, the nav tree, the registry) make mounting it impractical.
 */
const VIEW = path.join(process.cwd(), "src/components/docs-page-view.tsx");

function soleRender(tag: string): string {
  const source = fs.readFileSync(VIEW, "utf-8");
  const renders = source.split(tag).slice(1);
  expect(renders).toHaveLength(1);
  return openingTagAttributes(renders[0]);
}

describe("docs-page-view MDX prompt context", () => {
  it("passes markdownUrl and onboardingFrontend at <MdxFrameworkOverview", () => {
    const attributes = soleRender("<MdxFrameworkOverview");
    // A value, not just the name — `markdownUrl={undefined}` and
    // `markdownUrl={""}` both compile and would satisfy a substring match
    // while dropping the page sentence.
    expect(attributes).toMatch(valuedPropPattern("markdownUrl"));
    expect(attributes).toMatch(valuedPropPattern("onboardingFrontend"));
  });

  it("passes framework at <IntelligenceOnboardingPromptMdx", () => {
    expect(soleRender("<IntelligenceOnboardingPromptMdx")).toMatch(
      valuedPropPattern("framework"),
    );
  });
});
