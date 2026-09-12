import type { ComponentProps } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPILOTKIT_CAPABILITIES } from "@/lib/homepage-map";

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

const useFrameworkMock = vi.fn();
vi.mock("../framework-provider", () => ({
  useFramework: () => useFrameworkMock(),
}));

// Import after the mocks are registered so the component picks them up.
import { ScopedCapabilities } from "../docs-map-scoped-capabilities";

const NO_HARD_COLOUR =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z-])|\brgb\(|\bhsl\(/;

const FRAMEWORKS = {
  "built-in-agent": { hrefPrefix: "" },
  mastra: { hrefPrefix: "/mastra" },
} as const;

function setFramework(overrides: {
  framework?: string | null;
  storedFramework?: string | null;
  effectiveFramework?: string;
}) {
  useFrameworkMock.mockReturnValue({
    framework: overrides.framework ?? null,
    storedFramework: overrides.storedFramework ?? null,
    effectiveFramework: overrides.effectiveFramework ?? "built-in-agent",
    knownFrameworks: ["built-in-agent", "mastra"],
  });
}

function render(props?: { frameworks?: typeof FRAMEWORKS }) {
  return renderToStaticMarkup(
    <ScopedCapabilities
      capabilities={COPILOTKIT_CAPABILITIES}
      frameworks={props?.frameworks ?? FRAMEWORKS}
    />,
  );
}

describe("ScopedCapabilities", () => {
  it("renders all six CopilotKit capability titles", () => {
    setFramework({});
    const markup = render();

    for (const capability of COPILOTKIT_CAPABILITIES) {
      expect(markup).toContain(capability.title);
    }
  });

  it("gives a first-time visitor unprefixed hrefs", () => {
    setFramework({});
    const markup = render();

    expect(markup).toContain('href="/generative-ui"');
    expect(markup).not.toContain('href="/mastra/generative-ui"');
  });

  it("scopes hrefs to a remembered framework", () => {
    setFramework({ storedFramework: "mastra" });
    const markup = render();

    expect(markup).toContain('href="/mastra/generative-ui"');
  });

  // The scoping is now the whole of what the remembered framework does here:
  // the tiles' hrefs move, and nothing announces the scope in prose or
  // offers to change it.
  it("says nothing about the scope in prose", () => {
    setFramework({ storedFramework: "mastra" });
    const markup = render();

    expect(markup).not.toContain("Scoped to");
    expect(markup).not.toContain("Change framework");
  });

  // `frameworks` is built with `Object.fromEntries`, so bare `in`/bracket
  // access on it is satisfied by inherited `Object.prototype` members —
  // "constructor", "toString", "valueOf", "__proto__" all read as truthy
  // even though `Object.keys(frameworks)` doesn't contain them. Both lookups
  // in the component must be `Object.hasOwn`, prototype-safe like the old
  // `knownFrameworks.includes(storedFramework)` array check they replaced.
  //
  // There are two of them, and one case cannot exercise both: the remembered
  // check gates the scope check, so a prototype key in localStorage never
  // reaches the second lookup, and a prototype key in the URL never reaches
  // the first. Hence one test each — an assertion that only fails when both
  // lookups are broken at once is an assertion that catches neither.
  it("ignores a prototype-inherited key as a remembered framework", () => {
    // `effectiveFramework` is a prefixed framework here so that ignoring the
    // bogus remembered slug is visible in the markup: the fallback must be
    // the effective framework's prefix, not the empty prefix a
    // prototype-inherited hit would resolve to.
    setFramework({
      storedFramework: "constructor",
      effectiveFramework: "mastra",
    });
    const markup = render();

    expect(markup).toContain('href="/mastra/generative-ui"');
  });

  it("ignores a prototype-inherited key as the resolved scope", () => {
    // The URL framework is passed through unvalidated by design (the route
    // only serves known slugs), so it is the one input that reaches the
    // second lookup directly. Under a bare bracket lookup,
    // `frameworks["constructor"]` is the `Object` function, whose
    // `hrefPrefix` is undefined — every tile would link at
    // "undefined/generative-ui".
    setFramework({ framework: "constructor" });
    const markup = render();

    expect(markup).toContain('href="/generative-ui"');
    expect(markup).not.toMatch(/href="[^"]*undefined[^"]*"/);
  });

  it("ignores a remembered slug absent from the frameworks record", () => {
    setFramework({ storedFramework: "vue" });
    const markup = render();

    expect(markup).toContain('href="/generative-ui"');
    expect(markup).not.toContain('href="/vue/generative-ui"');
    expect(markup).not.toContain("vue");
  });

  it("prefers a URL framework over a remembered one", () => {
    setFramework({ framework: "built-in-agent", storedFramework: "mastra" });
    const markup = render();

    expect(markup).toContain('href="/generative-ui"');
    expect(markup).not.toContain('href="/mastra/generative-ui"');
  });

  it("passes an absolute capability href through unprefixed", () => {
    setFramework({ storedFramework: "mastra" });
    const absoluteCapabilities = [
      {
        title: "External",
        body: "An external destination.",
        href: "https://example.com/external",
        icon: "MessageSquare",
      },
    ] as const;
    const markup = renderToStaticMarkup(
      <ScopedCapabilities
        capabilities={absoluteCapabilities}
        frameworks={FRAMEWORKS}
      />,
    );

    expect(markup).toContain('href="https://example.com/external"');
  });

  it("uses design tokens instead of hard-coded colours", () => {
    setFramework({ storedFramework: "mastra" });
    expect(render()).not.toMatch(NO_HARD_COLOUR);
  });

  // The regression this whole client/server split exists to prevent: a
  // value import of `@/lib/registry` (or a runtime import of
  // `@/lib/homepage-map`) would drag registry.json's ~646 KB into this
  // client bundle.
  it("imports no registry code and only types from homepage-map", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../docs-map-scoped-capabilities.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/from ["']@\/lib\/registry["']/);

    const homepageMapImports = source.match(
      /^import\s+.*from\s+["']@\/lib\/homepage-map["'];?$/gm,
    );
    expect(homepageMapImports).not.toBeNull();
    for (const line of homepageMapImports ?? []) {
      expect(line).toMatch(/^import\s+type\s+/);
    }
  });
});
