import type { ComponentProps } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COPILOTKIT_CAPABILITIES,
  INTELLIGENCE_CAPABILITIES,
  agentPicks,
  frontendPicks,
} from "@/lib/homepage-map";
import { getDocsMode, getIntegrations } from "@/lib/registry";

// Same shape as docs-map-parts.test.tsx's `next/link` mock. Typing the rest
// parameter `never` fails `tsc` under `strict` (TS2700): a rest element
// needs an object type, and `never` isn't one.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `ScopedCapabilities` (the client leaf composed as this file's child) calls
// `useFramework`, which throws outside a `FrameworkProvider`. Mock it so the
// server tree can render standalone, the same way
// docs-map-scoped-capabilities.test.tsx does. Routed through a `vi.fn()`
// (same shape as docs-map-scoped-capabilities.test.tsx's `useFrameworkMock`)
// so one test can swap in a hidden slug without disturbing the rest.
const useFrameworkMock = vi.fn();
vi.mock("../framework-provider", () => ({
  useFramework: () => useFrameworkMock(),
}));

// Import after the mocks are registered so the component tree picks them up.
import {
  DocsProductMap,
  DOCS_MAP_FRAMEWORKS_ANCHOR,
} from "../docs-product-map";

const NO_HARD_COLOUR =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z-])|\brgb\(|\bhsl\(/;

function render() {
  return renderToStaticMarkup(<DocsProductMap />);
}

/**
 * Brand marks carry brand colours by definition — Vue's green, Slack's four
 * — and `FrontendLogo`/`FrameworkLogo` are shared components this map only
 * consumes. Strip the marks so the token check still covers every class and
 * inline style the map itself writes.
 */
function withoutBrandMarks(markup: string): string {
  return markup.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<img[^>]*>/g, "");
}

/** Every pick link, identified by the class `PickGrid` gives them. */
function pickAnchors(markup: string): string[] {
  return Array.from(
    markup.matchAll(
      /<a [^>]*class="shell-docs-radius-control flex items-center[^"]*"[\s\S]*?<\/a>/g,
    ),
  ).map((match) => match[0]);
}

describe("DocsProductMap", () => {
  beforeEach(() => {
    useFrameworkMock.mockReturnValue({
      framework: null,
      storedFramework: "mastra",
      effectiveFramework: "built-in-agent",
      knownFrameworks: ["built-in-agent", "mastra"],
    });
  });

  it("frames the map with the intro heading and paragraph", () => {
    const markup = render();

    expect(markup).toContain("How CopilotKit fits together");
    // Verbatim, em dash included: this paragraph is what states the
    // relationship in words, and it is the only thing carrying it on a
    // narrow screen where the map collapses to one column.
    expect(markup).toContain(
      "Your frontend and your agent are yours to choose. CopilotKit sits between them — the SDK in your app, the runtime on your server. CopilotKit Intelligence attaches to that runtime when you take it to production.",
    );
  });

  it("renders the intro and the four block names in story order", () => {
    const markup = render();

    // Match on the `<h2>` heading markup `MapBlock` renders for `name`,
    // not bare substrings: "Frontend" also appears inside the CopilotKit
    // block's "Frontend tools" capability tile, and "CopilotKit" appears
    // inside the Frontend block's own description ("CopilotKit ships the
    // same primitives…"). An `indexOf` walk over those substrings stays
    // green even when the Frontend and CopilotKit blocks are swapped, so
    // this asserts exact equality on the ordered list of heading text
    // instead.
    const headings = Array.from(markup.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)).map(
      (match) => match[1],
    );

    expect(headings).toEqual([
      "How CopilotKit fits together",
      "Frontend",
      "CopilotKit",
      "CopilotKit Intelligence",
      "Agent",
    ]);
  });

  it("gives the CopilotKit block the core treatment and Intelligence the plus treatment", () => {
    const markup = render();

    // Each `MapBlock` renders one `<section class="...">` whose class
    // attribute carries its variant's distinguishing classes before any
    // nested markup. Look each section up by its own `<h2>` text (not by
    // position) so a variant swap between the CopilotKit and Intelligence
    // blocks flips which name sees which classes and fails this.
    const sections = Array.from(
      markup.matchAll(
        /<section[^>]*class="([^"]*)"[^>]*>[\s\S]*?<h2[^>]*>([^<]*)<\/h2>/g,
      ),
    ).map((match) => ({ classes: match[1], name: match[2] }));

    const copilotKit = sections.find(
      (section) => section.name === "CopilotKit",
    );
    const intelligence = sections.find(
      (section) => section.name === "CopilotKit Intelligence",
    );

    // core: solid border + `bg-[var(--bg-surface)]`.
    expect(copilotKit?.classes).toContain("bg-[var(--bg-surface)]");
    expect(copilotKit?.classes).not.toContain("bg-[var(--accent-dim)]");
    expect(copilotKit?.classes).not.toContain("border-[var(--accent)]");

    // plus: `border-[var(--accent)]` + `bg-[var(--accent-dim)]`.
    expect(intelligence?.classes).toContain("border-[var(--accent)]");
    expect(intelligence?.classes).toContain("bg-[var(--accent-dim)]");
  });

  it("gives the + adds elbow the accent treatment and the AG-UI axis the plain one", () => {
    const markup = render();

    const adds = markup.match(/<span class="([^"]*)">\+ adds<\/span>/);
    const agUi = markup.match(/<a href="[^"]*" class="([^"]*)">AG-UI<\/a>/);

    expect(adds?.[1]).toContain("border-[var(--accent)]");
    expect(adds?.[1]).toContain("bg-[var(--accent-dim)]");

    expect(agUi?.[1]).toContain("border-dashed");
    expect(agUi?.[1]).not.toContain("bg-[var(--accent-dim)]");
  });

  // The protocol between the agent and the runtime is a documented thing, so
  // the pill that names it must be reachable rather than decoration.
  it("links the AG-UI pill at the agentic-protocols page", () => {
    const markup = render();

    expect(markup).toMatch(
      /<a href="\/ag-ui\/agentic-protocols"[^>]*>AG-UI<\/a>/,
    );
  });

  it("scopes a CopilotKit capability href to exactly /mastra/generative-ui for the remembered framework", () => {
    const markup = render();

    // The mocked `storedFramework` is "mastra". A doubled or missing slash
    // in the `hrefPrefix` contract (e.g. `scopedHref("/", slug)` instead of
    // `scopedHref("", slug)`) would produce `/mastra//generative-ui`
    // instead of this exact string.
    expect(markup).toContain('href="/mastra/generative-ui"');
  });

  it("renders all twelve capability titles", () => {
    const markup = render();

    for (const capability of [
      ...COPILOTKIT_CAPABILITIES,
      ...INTELLIGENCE_CAPABILITIES,
    ]) {
      expect(markup).toContain(capability.title);
    }
  });

  it("renders the accent connector label", () => {
    expect(render()).toContain("+ adds");
  });

  it("renders the AG-UI axis label", () => {
    expect(render()).toContain("AG-UI");
  });

  // The Intelligence block used to wear a "free to start" badge. It said
  // nothing about how the pieces fit and read as pricing on a page whose job
  // is orientation.
  it("carries no badge and no premium language anywhere", () => {
    const markup = render();

    expect(markup).not.toContain("Free to start");
    expect(markup).not.toContain("cloud or self-hosted");
    expect(markup.toLowerCase()).not.toContain("premium");
  });

  // Scoping still follows the remembered agent backend — it just does so
  // silently, in the tiles' hrefs.
  it("never announces the scope in prose", () => {
    const markup = render();

    expect(markup).not.toContain("Scoped to");
    expect(markup).not.toContain("Change framework");
  });

  it("renders the four blocks' kickers, descriptions and actions verbatim", () => {
    const markup = render();

    // The four blocks' kickers. Frontend and Agent deliberately share the
    // same kicker text.
    expect(markup).toContain("Bring your own · your choice");
    expect(markup).toContain("Open source · the product");
    expect(markup).toContain("When real users arrive");

    // The four blocks' description lines, copied verbatim (middots and em
    // dashes included) so a copy edit that drifts from the spec fails.
    expect(markup).toContain(
      "CopilotKit ships the same primitives for every one of these. Pick the one you already use — nothing else on this page changes.",
    );
    expect(markup).toContain(
      "The SDK in your app and the runtime on your server. Everything your users actually touch, running entirely on your side.",
    );
    expect(markup).toContain(
      "The platform your runtime talks to. Remembers, learns, and shows you what happened — without changing your frontend or your agent framework.",
    );
    // `renderToStaticMarkup` escapes the apostrophe in text content.
    expect(markup).toContain(
      "Any framework that speaks AG-UI, or CopilotKit&#x27;s own built-in agent.",
    );

    // The two blocks' action labels.
    expect(markup).toContain("Quickstart");
    expect(markup).toContain("Connect in 5 minutes");
  });

  // Derived rather than hardcoded: a literal slug like "spring-ai" stops
  // exercising this filter the moment that integration is removed from the
  // registry (plausible for a deprecated one) — both assertions would keep
  // passing for an unrelated reason, and the test would stop catching a
  // regression in the filter itself.
  const hiddenIntegration = getIntegrations().find(
    (integration) => getDocsMode(integration.slug) === "hidden",
  );

  (hiddenIntegration ? it : it.skip)(
    "falls back to an unprefixed scope when the remembered slug is docs_mode: hidden",
    () => {
      // `DocsProductMap` builds `frameworks` from the real registry, so this
      // exercises the actual filter rather than a hand-built stand-in: with
      // the filter in place, the hidden slug is missing from the record,
      // `remembered` resolves to null, and the scope falls back to
      // `effectiveFramework` ("built-in-agent", the root framework) —
      // unprefixed links, not a scope pointed at pages that 404.
      const hiddenSlug = hiddenIntegration!.slug;
      useFrameworkMock.mockReturnValue({
        framework: null,
        storedFramework: hiddenSlug,
        effectiveFramework: "built-in-agent",
        knownFrameworks: ["built-in-agent", hiddenSlug],
      });

      const markup = render();

      expect(markup).toContain('href="/generative-ui"');
      expect(markup).not.toContain(`href="/${hiddenSlug}/generative-ui"`);
    },
  );

  // The kite is Intelligence's mark; this viewBox is unique to
  // `IntelligenceKiteIcon`, so it identifies the icon rather than any other
  // svg in the map.
  it("puts the Intelligence kite beside the Intelligence name", () => {
    const markup = render();

    const intelligenceBlock = markup.slice(markup.indexOf('id="intelligence"'));
    expect(intelligenceBlock).toContain('viewBox="10 0 71 76"');
    expect(intelligenceBlock.indexOf('viewBox="10 0 71 76"')).toBeLessThan(
      intelligenceBlock.indexOf("CopilotKit Intelligence"),
    );
  });

  it("draws a visible logo on every frontend and agent pick", () => {
    const markup = render();
    const anchors = pickAnchors(markup);

    expect(anchors).toHaveLength(frontendPicks().length + agentPicks().length);
    for (const anchor of anchors) {
      // A slug with no bundled mark and no registry logo would render an
      // empty spacer span, which is what this catches.
      expect(anchor, anchor).toMatch(/<svg|<img/);
    }
  });

  it("carries the frameworks anchor and the intelligence anchor", () => {
    const markup = render();

    expect(DOCS_MAP_FRAMEWORKS_ANCHOR).toBe("frameworks");
    expect(markup).toContain('id="frameworks"');
    expect(markup).toContain('id="intelligence"');
  });

  // The hero owns the page's one action; the map is pure navigation.
  it("has no button and no copy-prompt affordance", () => {
    const markup = render();

    expect(markup).not.toContain("<button");
    expect(markup).not.toMatch(/Copy\s+.*prompt/i);
  });

  it("never prefixes the absolute Analytics href, even for a remembered non-root framework", () => {
    const markup = render();

    expect(markup).toContain(
      'href="https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights"',
    );
    expect(markup).not.toContain(
      'href="/mastrahttps://www.copilotkit.ai/copilotkit-intelligence#analytics-insights"',
    );
  });

  it("uses design tokens only — no hex, rgb() or hsl() colours", () => {
    expect(withoutBrandMarks(render())).not.toMatch(NO_HARD_COLOUR);
  });

  // The regression this file exists to prevent: this must stay a server
  // component. `renderToStaticMarkup` above already proves it renders
  // synchronously with no provider in the tree; this additionally proves
  // the source carries no client marker and no direct hook usage.
  it("declares no 'use client' and does not import useFramework directly", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../docs-product-map.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["'];?\s*$/m);
    expect(source).not.toMatch(/useFramework/);
  });
});
