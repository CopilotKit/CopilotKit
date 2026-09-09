import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsLayerDiagram } from "../docs-layer-diagram";

describe("DocsLayerDiagram", () => {
  it("names all three layers, the protocol and the agent frameworks as real text", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    for (const layer of ["Frontend", "Runtime", "Intelligence"]) {
      expect(markup).toContain(`>${layer}<`);
    }

    expect(markup).toContain("AG-UI");
    expect(markup).toContain("Your agent");
    expect(markup).toContain(
      "LangGraph · Mastra · Agno · CrewAI · ADK · and more",
    );
  });

  it("states which side of the boundary each layer sits on", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    expect(markup).toContain("runs on your side");
    expect(markup).toContain("the platform");
  });

  it("renders as markup rather than an image", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain(".png");
    expect(markup).not.toContain(".svg");
  });

  it("uses design tokens instead of hard-coded colours", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/\brgba?\(/);
    expect(markup).toContain("var(--border)");
  });

  it("stacks the layers on narrow viewports so nothing overflows at 375px", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    // One column by default, three only from `sm` up.
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("sm:grid-cols-3");
  });

  it("keeps exactly one copy of the side labels visible at any viewport width", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    // The bracket row is wide-only; the per-box eyebrows are narrow-only.
    // If either guard were dropped, the labels would be announced twice.
    expect(markup).toContain("hidden grid-cols-3");
    expect(markup).toContain("sm:hidden");
  });

  it("wraps itself in not-prose so MDX prose styles do not leak in", () => {
    const markup = renderToStaticMarkup(<DocsLayerDiagram />);

    expect(markup).toContain("not-prose");
  });
});
