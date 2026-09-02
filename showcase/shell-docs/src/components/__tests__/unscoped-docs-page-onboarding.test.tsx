// Guards which ROOT-SURFACE pages get the page-tools "Copy agent prompt"
// button. `UnscopedDocsPage` serves three kinds of page and the button must
// follow exactly one of them:
//
//   1. a Built-in-Agent-authored override (`/frontend-tools`)  → button
//   2. an agnostic page declaring a snippet cell (`/agentic-chat-ui`) → button
//   3. a genuinely frameworkless page (`/faq`, `/examples`)    → NO button
//
// The rule is that the button follows `frameworkOverride`, so every case below
// asserts BOTH props: if the two ever diverge — a page resolving its content
// BIA-scoped but naming no framework in the prompt, or the reverse — that is
// the regression these tests exist to catch.
//
// Tested by CALLING the server component and reading the `DocsPageView`
// element it returns, rather than rendering it. Rendering would compile the
// page's MDX through `next-mdx-remote` and mount the whole docs shell, none of
// which this rule depends on; the returned props are the seam where the branch
// actually decides.

import { describe, expect, it } from "vitest";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";

const BIA = { slug: "built-in-agent", name: "Built-in Agent" };

async function docsPageViewProps(
  slugPath: string,
): Promise<Record<string, unknown>> {
  const element = (await UnscopedDocsPage({ slugPath })) as {
    props: Record<string, unknown>;
  };
  return element.props;
}

describe("UnscopedDocsPage onboarding framework", () => {
  it("names the Built-in Agent on a BIA-authored root page", async () => {
    const props = await docsPageViewProps("frontend-tools");

    expect(props.contentSlugPath).toBe(
      "integrations/built-in-agent/frontend-tools",
    );
    expect(props.frameworkOverride).toBe("built-in-agent");
    expect(props.onboardingFramework).toEqual(BIA);
  });

  it("names the Built-in Agent on an agnostic page with a snippet cell", async () => {
    // No BIA override on disk for this slug, so it renders the root MDX — but
    // resolved against the default framework, which is what it documents.
    const props = await docsPageViewProps("agentic-chat-ui");

    expect(props.contentSlugPath).toBeUndefined();
    expect(props.frameworkOverride).toBe("built-in-agent");
    expect(props.onboardingFramework).toEqual(BIA);
  });

  it("names no framework on a frameworkless root page", async () => {
    for (const slugPath of ["faq", "examples"]) {
      const props = await docsPageViewProps(slugPath);

      expect(props.frameworkOverride).toBeUndefined();
      expect(props.onboardingFramework).toBeUndefined();
    }
  });
});
