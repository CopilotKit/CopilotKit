// Guards which ROOT-SURFACE pages get the page-tools "Copy agent prompt"
// button. The answer is: all of them, always naming the Built-in Agent.
//
// The root surface is the Built-in Agent's lens on the docs — `/faq` and
// `/mastra/faq` are the same page read with a different framework selected —
// so the button cannot depend on which of the two URLs the reader arrived
// through. `UnscopedDocsPage` serves three kinds of page and every one of
// them gets the button:
//
//   1. a Built-in-Agent-authored override (`/frontend-tools`)
//   2. an agnostic page declaring a snippet cell (`/agentic-chat-ui`)
//   3. a page with neither (`/faq`, `/backend/copilot-runtime`)
//
// `frameworkOverride` keeps its own, narrower per-branch value: it says which
// framework's snippets and gated blocks the CONTENT resolves against, which
// only cases 1 and 2 do. Every case below asserts BOTH props, so a future
// change that re-couples them fails here.
//
// Tested by CALLING the server component and reading the `DocsPageView`
// element it returns, rather than rendering it. Rendering would compile the
// page's MDX through `next-mdx-remote` and mount the whole docs shell, none of
// which this rule depends on; the returned props are the seam where the branch
// actually decides.

import { describe, expect, it } from "vitest";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";

const BIA = { slug: "built-in-agent", name: "Built-in" };
// This component only serves URLs whose first segment is not a frontend id, so
// every one of its branches resolves to the docs' default React frontend.
const REACT = { id: "react", name: "React" };

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
    expect(props.onboardingFrontend).toEqual(REACT);
  });

  it("names the Built-in Agent on an agnostic page with a snippet cell", async () => {
    // No BIA override on disk for this slug, so it renders the root MDX — but
    // resolved against the default framework, which is what it documents.
    const props = await docsPageViewProps("agentic-chat-ui");

    expect(props.contentSlugPath).toBeUndefined();
    expect(props.frameworkOverride).toBe("built-in-agent");
    expect(props.onboardingFramework).toEqual(BIA);
    expect(props.onboardingFrontend).toEqual(REACT);
  });

  it("names the Built-in Agent on a page with no cell and no BIA override", async () => {
    // The concrete regression this rule exists to close: these pages have a
    // `/<framework>/…` twin that carries the button (`/mastra/faq`,
    // `/mastra/backend/copilot-runtime`), so the root URL must carry it too.
    for (const slugPath of ["backend/copilot-runtime", "faq"]) {
      const props = await docsPageViewProps(slugPath);

      // Unchanged: content resolution stays framework-agnostic here. The
      // button no longer follows this prop.
      expect(props.frameworkOverride).toBeUndefined();
      expect(props.onboardingFramework).toEqual(BIA);
      expect(props.onboardingFrontend).toEqual(REACT);
    }
  });
});
