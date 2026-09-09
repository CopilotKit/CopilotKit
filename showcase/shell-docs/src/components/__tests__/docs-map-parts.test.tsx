import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CapabilityTile,
  MapBlock,
  MapConnector,
  PickGrid,
} from "../docs-map-parts";

// The plan's verbatim mock typed this parameter `never`, which cannot
// type-check under `strict`: a rest element requires an object type, and
// `never` isn't one (TS2700). `ComponentProps<"a">` is the annotation this
// suite's other `next/link` mocks already use for the identical shape.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NO_HARD_COLOUR =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z-])|\brgb\(|\bhsl\(/;

// Hoisted out of the `describe` block (oxlint's `consistent-function-scoping`):
// it captures nothing from an enclosing scope, so it need not be recreated
// per suite run.
function render(variant: "choice" | "core" | "plus") {
  return renderToStaticMarkup(
    <MapBlock
      variant={variant}
      kicker="Kicker text"
      name="Block name"
      description="What this block is."
      action={{ label: "Go there", href: "/somewhere" }}
      id="block-id"
    >
      <p>child</p>
    </MapBlock>,
  );
}

describe("MapBlock", () => {
  it("renders kicker, name, description, action and children", () => {
    const markup = render("core");

    expect(markup).toContain("Kicker text");
    expect(markup).toContain("Block name");
    expect(markup).toContain("What this block is.");
    expect(markup).toContain('href="/somewhere"');
    expect(markup).toContain("<p>child</p>");
    expect(markup).toContain('id="block-id"');
    expect(markup).toContain("not-prose");
  });

  // The three treatments are the only thing carrying the page's hierarchy, so
  // a change that made them look alike must fail here rather than in review.
  it("gives the choice variant a dashed border and no shadow", () => {
    const markup = render("choice");

    expect(markup).toContain("border-dashed");
    expect(markup).not.toContain("shadow-[var(--shadow-panel)]");
  });

  it("gives the core variant a solid surface with the panel shadow", () => {
    const markup = render("core");

    expect(markup).not.toContain("border-dashed");
    expect(markup).toContain("shadow-[var(--shadow-panel)]");
  });

  // Asserting on `var(--accent)` alone would pass even if `plus`'s block
  // class were made byte-identical to `core`'s: the action `<Link>` that the
  // shared `render` helper always passes carries `text-[var(--accent)]` in
  // every variant, so that token appears in the markup regardless. Assert on
  // the border colour and fill unique to `plus`'s block class instead.
  it("gives the plus variant an accent border, accent-tinted fill and the panel shadow", () => {
    const markup = render("plus");

    expect(markup).toContain("border-[var(--accent)]");
    expect(markup).toContain("bg-[var(--accent-dim)]");
    expect(markup).not.toContain("border-dashed");
    expect(markup).toContain("shadow-[var(--shadow-panel)]");
  });

  it("omits the action element when no action is given", () => {
    const markup = renderToStaticMarkup(
      <MapBlock variant="choice" kicker="K" name="N" description="D">
        <span />
      </MapBlock>,
    );

    expect(markup).not.toContain("<a");
  });

  it("uses design tokens instead of hard-coded colours", () => {
    expect(render("plus")).not.toMatch(NO_HARD_COLOUR);
  });

  it("sizes the name from nameSize instead of a fixed size", () => {
    const small = renderToStaticMarkup(
      <MapBlock
        variant="core"
        kicker="K"
        name="N"
        nameSize="sm"
        description="D"
      >
        <span />
      </MapBlock>,
    );
    const large = renderToStaticMarkup(
      <MapBlock variant="core" kicker="K" name="N" description="D">
        <span />
      </MapBlock>,
    );

    expect(small).toContain("text-base");
    expect(small).not.toContain("text-xl");
    expect(large).toContain("text-xl");
    expect(large).not.toContain("text-base");
  });

  it("renders the badge text when a badge is given, and omits it otherwise", () => {
    const withBadge = renderToStaticMarkup(
      <MapBlock
        variant="core"
        kicker="K"
        name="N"
        description="D"
        badge="Free to start · cloud or self-hosted"
      >
        <span />
      </MapBlock>,
    );
    const withoutBadge = renderToStaticMarkup(
      <MapBlock variant="core" kicker="K" name="N" description="D">
        <span />
      </MapBlock>,
    );

    expect(withBadge).toContain("Free to start · cloud or self-hosted");
    expect(withoutBadge).not.toContain("Free to start · cloud or self-hosted");
  });
});

describe("MapConnector", () => {
  it("renders a bare rule with no label by default", () => {
    const markup = renderToStaticMarkup(<MapConnector variant="plain" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("var(--border)");
  });

  it("renders the label when one is given", () => {
    const markup = renderToStaticMarkup(
      <MapConnector variant="plain" label="AG-UI" />,
    );

    expect(markup).toContain("AG-UI");
  });

  // "+ adds" is one of the things saying Intelligence is attached rather
  // than merely next to the stacked blocks — Block 3's own description line
  // says as much too, so this connector reinforces rather than carries it
  // alone.
  it("tints the accent variant so the added layer reads as attached", () => {
    const markup = renderToStaticMarkup(
      <MapConnector variant="accent" label="+ adds" />,
    );

    expect(markup).toContain("var(--accent)");
    expect(markup).toContain("+ adds");
  });
});

describe("CapabilityTile", () => {
  const capability = {
    title: "Generative UI",
    body: "Your agent returns real React components, not just text.",
    href: "/generative-ui",
    icon: "Paintbrush",
  } as const;

  it("renders the icon, title, body and the scoped href it was given", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTile
        capability={capability}
        href="/mastra/generative-ui"
        tone="core"
      />,
    );

    expect(markup).toContain("Generative UI");
    expect(markup).toContain("real React components");
    expect(markup).toContain('href="/mastra/generative-ui"');
    expect(markup).toContain("<svg");
  });

  it("marks the icon decorative, since the title already names the tile", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTile capability={capability} href="/x" tone="core" />,
    );

    expect(markup).toContain('aria-hidden="true"');
  });

  it("tints the plus tone so the Intelligence block stays consistent inside", () => {
    const core = renderToStaticMarkup(
      <CapabilityTile capability={capability} href="/x" tone="core" />,
    );
    const plus = renderToStaticMarkup(
      <CapabilityTile capability={capability} href="/x" tone="plus" />,
    );

    expect(plus).not.toBe(core);
    expect(plus).toContain("var(--accent");
  });

  it("uses design tokens instead of hard-coded colours", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTile capability={capability} href="/x" tone="plus" />,
    );

    expect(markup).not.toMatch(NO_HARD_COLOUR);
  });
});

describe("PickGrid", () => {
  it("links every pick and renders its qualifier when it has one", () => {
    const markup = renderToStaticMarkup(
      <PickGrid
        picks={[
          { id: "vue", name: "Vue", href: "/vue" },
          {
            id: "slack",
            name: "Slack",
            href: "/slack",
            note: "needs Intelligence",
          },
        ]}
      />,
    );

    expect(markup).toContain('href="/vue"');
    expect(markup).toContain("Vue");
    expect(markup).toContain('href="/slack"');
    expect(markup).toContain("needs Intelligence");
  });

  it("stacks to one column on a narrow viewport", () => {
    const markup = renderToStaticMarkup(
      <PickGrid picks={[{ id: "vue", name: "Vue", href: "/vue" }]} />,
    );

    expect(markup).toContain("grid-cols-1");
  });
});
