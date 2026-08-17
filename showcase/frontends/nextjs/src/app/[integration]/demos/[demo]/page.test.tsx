import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DemoPlaceholderPage from "./page";

async function render(integration: string, demo: string): Promise<string> {
  const element = await DemoPlaceholderPage({
    params: Promise.resolve({ integration, demo }),
  });
  return renderToStaticMarkup(element);
}

describe("/<integration>/demos/<demo> placeholder", () => {
  it("renders the placeholder for a supported pair", async () => {
    const html = await render("langgraph-python", "agentic-chat");
    expect(html).toContain("Demo not wired yet");
    expect(html).toContain("langgraph-python/agentic-chat");
  });

  it("renders the unavailable state for a demo the backend declares unsupported", async () => {
    const html = await render("langgraph-python", "gen-ui-interrupt");
    expect(html).toContain("Not supported");
    expect(html).toContain('role="alert"');
  });

  it("renders the unavailable state for a union pair with no backend", async () => {
    // agno never declares `a2ui-recovery` — the id exists only because other
    // integrations ship it. Structurally valid URL, no backend behind it.
    // Must render, not 404.
    const html = await render("agno", "a2ui-recovery");
    expect(html).toContain("Not supported");
    expect(html).toContain("agno/a2ui-recovery");
  });

  it("renders the malformed state for an unknown integration", async () => {
    const html = await render("does-not-exist", "agentic-chat");
    expect(html).toContain("Invalid Showcase route");
  });

  it("blocks the demo id the layout guard could be spoofed past", async () => {
    /**
     * WHY THIS PAIR SPECIFICALLY. `../layout.tsx` reads the demo id out of the
     * `x-pathname` header, because a layout at that path is handed
     * `[integration]` only. The middleware matcher used to skip any path
     * containing a dot, so for `/mastra/demos/gen-ui-interrupt.x` the header
     * was client-supplied and a spoofed `/mastra/demos/agentic-chat` passed
     * the layout guard — segment 0 agreed. THIS page was the only node that
     * answered, because it takes the real id from `params`.
     *
     * The matcher no longer skips demo routes (`src/middleware.ts`, pinned in
     * `middleware.test.ts` and end to end in `../layout.test.tsx`), so the
     * layout answers first again. This test keeps the second line of defence
     * honest anyway: it does not depend on the header, and deleting the
     * `resolveDemoSupport` call in `page.tsx` as a "redundant re-check" turns
     * it red.
     */
    const html = await render("mastra", "gen-ui-interrupt.x");
    expect(html).not.toContain("Demo not wired yet");
    expect(html).toContain("Invalid Showcase route");
  });
});
