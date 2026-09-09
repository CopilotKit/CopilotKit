import type { ComponentProps } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  COPILOTKIT_CAPABILITIES,
  INTELLIGENCE_CAPABILITIES,
} from "@/lib/homepage-map";

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
// docs-map-scoped-capabilities.test.tsx does.
vi.mock("../framework-provider", () => ({
  useFramework: () => ({
    framework: null,
    storedFramework: "mastra",
    effectiveFramework: "built-in-agent",
    knownFrameworks: ["built-in-agent", "mastra"],
  }),
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

describe("DocsProductMap", () => {
  it("renders the four block names in story order", () => {
    const markup = render();

    const names = [
      "Frontend",
      "CopilotKit",
      "CopilotKit Intelligence",
      "Agent",
    ];
    let cursor = -1;
    for (const name of names) {
      const index = markup.indexOf(name, cursor + 1);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
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

  it("renders the AG-UI connector label", () => {
    expect(render()).toContain("AG-UI");
  });

  it("renders the Intelligence badge exactly, with no premium language anywhere", () => {
    const markup = render();

    expect(markup).toContain("Free to start · cloud or self-hosted");
    expect(markup.toLowerCase()).not.toContain("premium");
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
    expect(render()).not.toMatch(NO_HARD_COLOUR);
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
