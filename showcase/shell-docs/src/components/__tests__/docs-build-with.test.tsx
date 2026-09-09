import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `useFramework` is the only hook this component reads, and the three fields
// it reads are exactly what the scope precedence is built from — so the mock
// sets them directly rather than driving the real provider through a URL and
// a localStorage effect (`renderToStaticMarkup` runs no effects, so the
// remembered-framework case would be unreachable that way).
const frameworkState = vi.hoisted(() => ({
  framework: null as string | null,
  storedFramework: null as string | null,
  effectiveFramework: "built-in-agent",
  knownFrameworks: ["built-in-agent", "mastra", "langgraph-python"],
}));

vi.mock("../framework-provider", () => ({
  useFramework: () => ({
    framework: frameworkState.framework,
    storedFramework: frameworkState.storedFramework,
    effectiveFramework: frameworkState.effectiveFramework,
    knownFrameworks: frameworkState.knownFrameworks,
    setStoredFramework: vi.fn(),
  }),
}));

import { DocsBuildWith } from "../docs-build-with";

/** Reset to what a first-time visitor on `/` gets: no URL scope, nothing remembered. */
function firstTimeVisitor() {
  frameworkState.framework = null;
  frameworkState.storedFramework = null;
  frameworkState.effectiveFramework = "built-in-agent";
  frameworkState.knownFrameworks = [
    "built-in-agent",
    "mastra",
    "langgraph-python",
  ];
}

const INTENTS: readonly { title: string; body: string; href: string }[] = [
  {
    title: "Add a chat surface",
    body: "Drop in a ready-made chat, sidebar, or popup.",
    href: "/prebuilt-components/chat",
  },
  {
    title: "Let the agent render UI",
    body: "Your agent returns real React components, not just text.",
    href: "/generative-ui",
  },
  {
    title: "Ask before acting",
    body: "Pause for the user&#x27;s approval at the steps that matter.",
    href: "/human-in-the-loop",
  },
  {
    title: "Build your own interface",
    body: "Headless hooks, your pixels.",
    href: "/custom-look-and-feel/headless-ui",
  },
];

describe("DocsBuildWith", () => {
  it("names all four intents in the reader's language", () => {
    firstTimeVisitor();
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    expect(markup).toContain("What you build with it");
    for (const intent of INTENTS) {
      expect(markup).toContain(intent.title);
      expect(markup).toContain(intent.body);
    }
    // Not MDX prose: the prose typography must not repaint this section.
    expect(markup).toContain("not-prose");
  });

  it("links the default framework's pages at the root surface, unprefixed", () => {
    firstTimeVisitor();
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    for (const intent of INTENTS) {
      expect(markup).toContain(`href="${intent.href}"`);
    }
    expect(markup).not.toContain("/built-in-agent/");
    expect(markup).toContain("Scoped to CopilotKit&#x27;s Built-in Agent.");
  });

  it("offers the framework grid as the one place the scope is changed", () => {
    firstTimeVisitor();
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    expect(markup).toContain('href="#frameworks"');
  });

  it("re-scopes every link to the framework the URL asserts", () => {
    firstTimeVisitor();
    frameworkState.framework = "mastra";
    frameworkState.effectiveFramework = "mastra";
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    for (const intent of INTENTS) {
      expect(markup).toContain(`href="/mastra${intent.href}"`);
    }
    expect(markup).toContain("Scoped to Mastra.");
  });

  it("upgrades a returning visitor to the framework they remembered", () => {
    // What the client render does once the provider has read localStorage:
    // the URL still asserts nothing (this section lives on `/`), so the
    // remembered framework is what the links must point at.
    firstTimeVisitor();
    frameworkState.storedFramework = "mastra";
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    expect(markup).toContain('href="/mastra/generative-ui"');
    expect(markup).toContain("Scoped to Mastra.");
  });

  it("ignores a remembered framework this docs site no longer serves", () => {
    // A stale or hand-edited localStorage value must not produce links into
    // a framework the registry cannot confirm — the reader would get a name
    // and four hrefs that disagree with each other.
    firstTimeVisitor();
    frameworkState.storedFramework = "not-a-framework";
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    expect(markup).not.toContain("/not-a-framework/");
    expect(markup).toContain('href="/generative-ui"');
    expect(markup).toContain("Scoped to CopilotKit&#x27;s Built-in Agent.");
  });

  it("stacks the cards on a narrow viewport instead of scrolling sideways", () => {
    firstTimeVisitor();
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("sm:grid-cols-2");
  });

  it("paints from design tokens only, with no hard-coded colour", () => {
    firstTimeVisitor();
    const markup = renderToStaticMarkup(<DocsBuildWith />);

    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(markup).toContain("var(--text)");
    expect(markup).toContain("var(--border)");
  });
});
