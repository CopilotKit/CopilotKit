import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CapabilityTile,
  MapAxis,
  MapBlock,
  MapConnector,
  MapElbow,
  MapGap,
  MapIntro,
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

describe("MapIntro", () => {
  it("renders the framing heading and paragraph", () => {
    const markup = renderToStaticMarkup(
      <MapIntro heading="How CopilotKit fits together" body="One paragraph." />,
    );

    expect(markup).toMatch(/<h2[^>]*>How CopilotKit fits together<\/h2>/);
    expect(markup).toContain("One paragraph.");
    expect(markup).toContain("not-prose");
  });

  // It frames the four blocks, so it must not read as a fifth one: a block's
  // `lg` name is `text-xl`, and this is the step above it.
  it("sets the heading a step above a block heading", () => {
    const markup = renderToStaticMarkup(<MapIntro heading="H" body="B" />);

    expect(markup).toContain("text-2xl");
    expect(markup).not.toContain("text-xl");
  });
});

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

  // Beside the name, never inside the `<h2>`: a heading whose text is
  // interrupted by markup is worse for assistive technology, and the map's
  // story-order guard reads the heading's text content.
  it("renders an icon beside the name and keeps the heading plain text", () => {
    const markup = renderToStaticMarkup(
      <MapBlock
        variant="plus"
        kicker="K"
        name="CopilotKit Intelligence"
        description="D"
        icon={<svg viewBox="0 0 1 1" />}
      >
        <span />
      </MapBlock>,
    );

    expect(markup).toContain("<svg");
    expect(markup).toMatch(/<h2[^>]*>CopilotKit Intelligence<\/h2>/);
  });

  // Intelligence is a side branch off the runtime, not another step in the
  // stack, and the inset is how the picture says so: three of the grid's
  // four columns, starting at column 2 — 75%, flush right.
  it("insets a block to the right three of four columns on request", () => {
    const inset = renderToStaticMarkup(
      <MapBlock
        variant="plus"
        placement="inset"
        kicker="K"
        name="N"
        description="D"
      >
        <span />
      </MapBlock>,
    );

    expect(render("core")).toContain("md:col-start-1");
    expect(render("core")).toContain("md:col-span-4");
    expect(inset).toContain("md:col-start-2");
    expect(inset).toContain("md:col-span-3");
  });
});

describe("MapConnector", () => {
  it("renders one decorative rule in a colour that is actually visible", () => {
    const markup = renderToStaticMarkup(<MapConnector />);

    expect(markup).toContain('aria-hidden="true"');
    // `--border` sits at a fraction of an opacity against this page's
    // near-black ground, which made the connectors read as missing rather
    // than as quiet. The muted text token is the visible one.
    expect(markup).toContain("bg-[var(--text-muted)]");
    expect(markup).not.toContain("bg-[var(--border)]");
  });
});

describe("MapElbow", () => {
  it("draws a right-angled elbow with the label on its horizontal run", () => {
    const markup = renderToStaticMarkup(<MapElbow label="+ adds" />);

    expect(markup).toContain("+ adds");
    expect(markup).toContain("var(--accent)");
    // A stretched stub down from CopilotKit's underside (`md:self-stretch`),
    // then runs that turn horizontal (`md:h-px`) and land on Intelligence's
    // top edge (`md:items-end`). No SVG and no offsets, so the elbow cannot
    // drift when the Intelligence block grows taller.
    expect(markup).toContain("md:self-stretch");
    expect(markup).toContain("md:h-px");
    expect(markup).toContain("md:items-end");
    expect(markup).not.toContain("<svg");
  });

  it("is decorative throughout, so it carries no link", () => {
    const markup = renderToStaticMarkup(<MapElbow label="+ adds" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("<a");
  });
});

describe("MapAxis", () => {
  it("makes the label a real link and hides only the decorative rules", () => {
    const markup = renderToStaticMarkup(
      <MapAxis label="AG-UI" href="/ag-ui/agentic-protocols" />,
    );

    expect(markup).toContain('href="/ag-ui/agentic-protocols"');
    expect(markup).toContain("AG-UI");
    // A link inside an `aria-hidden` subtree is a link that does not exist,
    // so the container must not carry the attribute — only the two rules do.
    const container = markup.slice(0, markup.indexOf(">") + 1);
    expect(container).not.toContain("aria-hidden");
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(2);
  });

  // The load-bearing claim of the whole layout: the axis starts at
  // CopilotKit's bottom edge and runs past Intelligence to the Agent block.
  // It does that by spanning the elbow row, the Intelligence row and the gap
  // row in the grid's first column.
  it("spans the elbow, Intelligence and gap rows in the first column", () => {
    const markup = renderToStaticMarkup(<MapAxis label="AG-UI" href="/x" />);

    expect(markup).toContain("md:col-start-1");
    expect(markup).toContain("md:row-start-5");
    expect(markup).toContain("md:row-span-3");
    expect(markup).toContain("bg-[var(--text-muted)]");
  });
});

describe("MapGap", () => {
  // Without a sized item in that row the grid collapses it and the axis
  // stops at Intelligence's bottom edge — the "Intelligence feeds the agent"
  // reading this layout exists to remove.
  it("holds the wide layout's gap row open and disappears when stacked", () => {
    const markup = renderToStaticMarkup(<MapGap />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("hidden");
    expect(markup).toContain("md:block");
    expect(markup).toContain("md:h-20");
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
          {
            id: "vue",
            name: "Vue",
            href: "/vue",
            logo: { kind: "frontend", icon: "vue" },
          },
          {
            id: "slack",
            name: "Slack",
            href: "/slack",
            note: "needs Intelligence",
            logo: { kind: "frontend", icon: "slack" },
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
      <PickGrid
        picks={[
          {
            id: "vue",
            name: "Vue",
            href: "/vue",
            logo: { kind: "frontend", icon: "vue" },
          },
        ]}
      />,
    );

    expect(markup).toContain("grid-cols-1");
  });

  // The grid draws whichever logo the pick's data named and decides nothing
  // itself, so both kinds must come out of the same dumb loop.
  it("draws a logo for every pick, of either kind", () => {
    const markup = renderToStaticMarkup(
      <PickGrid
        picks={[
          {
            id: "vue",
            name: "Vue",
            href: "/vue",
            logo: { kind: "frontend", icon: "vue" },
          },
          {
            id: "mastra",
            name: "Mastra",
            href: "/mastra",
            logo: { kind: "framework", slug: "mastra" },
          },
        ]}
      />,
    );

    const anchors = Array.from(markup.matchAll(/<a [\s\S]*?<\/a>/g)).map(
      (match) => match[0],
    );

    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).toMatch(/<svg|<img/);
    }
  });

  it("uses the registry logo when no bundled mark matches the slug", () => {
    const markup = renderToStaticMarkup(
      <PickGrid
        picks={[
          {
            id: "unknown",
            name: "Unknown",
            href: "/unknown",
            logo: {
              kind: "framework",
              slug: "no-such-framework",
              fallbackSrc: "https://example.com/logo.svg",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('src="https://example.com/logo.svg"');
  });
});
