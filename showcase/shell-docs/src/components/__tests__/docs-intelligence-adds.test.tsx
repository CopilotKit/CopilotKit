import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsIntelligenceAdds } from "../docs-intelligence-adds";

// The layer diagram is a slot, so the test supplies a stub instead of the real
// markup — this section is responsible for placing the diagram, not drawing it.
const DIAGRAM_STUB = <div data-testid="layer-diagram-stub">LAYER DIAGRAM</div>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function render(): string {
  return renderToStaticMarkup(<DocsIntelligenceAdds diagram={DIAGRAM_STUB} />);
}

describe("DocsIntelligenceAdds", () => {
  it("renders the diagram slot it is given", () => {
    const markup = render();

    expect(markup).toContain('data-testid="layer-diagram-stub"');
    expect(markup).toContain("LAYER DIAGRAM");
  });

  it("keeps the approved connecting and placement sentences verbatim", () => {
    const markup = render();

    expect(markup).toContain("What Intelligence adds in production");
    expect(markup).toContain(
      "That platform layer is what Intelligence adds. Here is what it changes:",
    );
    expect(markup).toContain(
      "Intelligence is the platform your runtime talks to — hosted by us, or running in your own cluster.",
    );
  });

  it("links every capability in the With Intelligence half to its docs page", () => {
    const markup = render();

    for (const [href, term] of [
      ["/threads", "They survive reloads, devices, and sessions"],
      ["/intelligence/memories", "Memory"],
      ["/learning", "Learning"],
      ["/inspector", "Inspector and analytics"],
    ]) {
      const anchor = new RegExp(
        `<a[^>]*href="${escapeRegExp(href)}"[^>]*>${escapeRegExp(term)}</a>`,
      );
      expect(markup, `${term} links to ${href}`).toMatch(anchor);
    }
  });

  it("states both sides of every pair so the stacked layout stays readable", () => {
    const markup = render();

    // Four pairs, each carrying its own pair of labels: at 375px the card
    // collapses to one column, and the labels are what tell the reader which
    // half is which once the two columns are gone.
    expect(markup.match(/Without Intelligence/g)).toHaveLength(4);
    expect(markup.match(/With Intelligence/g)).toHaveLength(4);
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("sm:grid-cols-2");

    for (const withoutState of [
      "Threads live in the session",
      "The agent knows the current conversation",
      "Usage happens and disappears",
      "You debug from logs",
    ]) {
      expect(markup).toContain(withoutState);
    }
  });

  it("offers the shortcut for existing CopilotKit users as a link", () => {
    const markup = render();

    expect(markup).toContain(
      "Already running CopilotKit? Connect Intelligence in five minutes",
    );
    expect(markup).toContain('href="/intelligence/quickstart"');
  });

  // The homepage carries the canonical onboarding prompt twice on purpose —
  // once in the hero, once in the Start section, with distinct telemetry
  // surfaces. A third clipboard affordance in this section made it impossible
  // to tell the prompts apart, which is the exact problem OSS-1141 sets out
  // to fix. This section therefore offers navigation, never a copy button.
  it("adds no clipboard affordance of its own", () => {
    const markup = render();

    expect(markup).not.toMatch(/Copy prompt|Show prompt text/);
    expect(markup).not.toContain("<button");
  });

  it("uses design tokens instead of hard-coded colours", () => {
    const markup = render();

    expect(markup).toContain("var(--text)");
    expect(markup).not.toMatch(
      /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z-])/,
    );
    expect(markup).not.toMatch(/\brgba?\(/);
    expect(markup).not.toMatch(/\bhsla?\(/);
  });
});
