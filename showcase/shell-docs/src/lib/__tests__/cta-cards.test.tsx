import React from "react";
import type { ReactElement, ReactNode } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocsPageView } from "@/components/docs-page-view";

import { resolveCtaCardHrefs } from "../docs-link-rewrite";
import { docsComponents } from "../mdx-registry";

type CTACard = {
  iconKey?: string;
  title: string;
  description?: string;
  href: string;
};

const CTACards = docsComponents.CTACards as React.ComponentType<{
  cards?: CTACard[];
  columns?: number;
  children?: React.ReactNode;
}>;

// The prop shape every human-in-the-loop landing page authors.
const cards: CTACard[] = [
  {
    iconKey: "circlePause",
    title: "Interrupt-based",
    description: "The agent pauses and your approval UI resumes the run.",
    href: "/human-in-the-loop/interrupt-flow",
  },
  {
    iconKey: "share2",
    title: "Tool-based",
    description: "A frontend tool renders UI and waits for the user.",
    href: "/human-in-the-loop/tool-based",
  },
];

describe("CTACards", () => {
  it("renders a link for every card in the cards prop", () => {
    const markup = renderToStaticMarkup(<CTACards columns={2} cards={cards} />);

    for (const card of cards) {
      expect(markup).toContain(card.href);
      expect(markup).toContain(card.title);
    }
  });

  it("renders a card whose iconKey is unknown instead of throwing", () => {
    const markup = renderToStaticMarkup(
      <CTACards
        cards={[{ iconKey: "nope", title: "Still here", href: "/x" }]}
      />,
    );

    expect(markup).toContain("Still here");
    expect(markup).toContain("/x");
  });

  it("ignores an iconKey that only matches an inherited property", () => {
    const markup = renderToStaticMarkup(
      <CTACards
        cards={[{ iconKey: "toString", title: "Inherited", href: "/y" }]}
      />,
    );

    expect(markup).toContain("Inherited");
    expect(markup).not.toContain("[object");
  });
});

describe("CTACards card hrefs", () => {
  it("resolves an authored href into the framework being read", () => {
    // The same option shape `docs-page-view.tsx` passes for
    // `/ms-agent-python/human-in-the-loop`.
    expect(
      resolveCtaCardHrefs(cards, {
        slugHrefPrefix: "/ms-agent-python",
        frameworkOverride: "ms-agent-python",
      }),
    ).toEqual([
      {
        ...cards[0],
        href: "/ms-agent-python/human-in-the-loop/interrupt-flow",
      },
      { ...cards[1], href: "/ms-agent-python/human-in-the-loop/tool-based" },
    ]);
  });

  it("keeps root-surface hrefs unprefixed", () => {
    expect(resolveCtaCardHrefs(cards, { slugHrefPrefix: "" })).toEqual(cards);
  });
});

// The two fixes above only reach a reader if the page wires them up:
// `blockJS` has to be off in the page's own MDXRemote options, and the
// page has to register the href-resolving `CTACards` override. Walk the
// rendered tree the way `docs-page-view-angular-backend.test.tsx` does
// and check both on the real page.
describe("DocsPageView CTACards wiring", () => {
  type MdxProps = {
    children?: ReactNode;
    components?: Record<string, React.ComponentType<Record<string, unknown>>>;
    options?: { blockJS?: boolean };
  };

  function findMdxRemote(node: ReactNode): ReactElement<MdxProps> | undefined {
    if (!React.isValidElement(node)) return undefined;

    const element = node as ReactElement<MdxProps>;
    if (element.type === MDXRemote) return element;

    for (const child of React.Children.toArray(element.props.children)) {
      const found = findMdxRemote(child);
      if (found) return found;
    }

    return undefined;
  }

  it("keeps expression props and prefixes card hrefs with the framework", async () => {
    const page = await DocsPageView({
      slugPath: "human-in-the-loop",
      contentSlugPath:
        "integrations/microsoft-agent-framework/human-in-the-loop",
      slugHrefPrefix: "/ms-agent-python",
      frameworkOverride: "ms-agent-python",
      navTree: [],
    });

    const mdx = findMdxRemote(page);
    expect(mdx).toBeDefined();
    expect(mdx!.props.options?.blockJS).toBe(false);

    const Override = mdx!.props.components?.CTACards;
    expect(Override).toBeDefined();

    const markup = renderToStaticMarkup(
      React.createElement(Override!, { cards, columns: 2 }),
    );
    expect(markup).toContain(
      'href="/ms-agent-python/human-in-the-loop/interrupt-flow"',
    );
    expect(markup).toContain(
      'href="/ms-agent-python/human-in-the-loop/tool-based"',
    );
  });
});
