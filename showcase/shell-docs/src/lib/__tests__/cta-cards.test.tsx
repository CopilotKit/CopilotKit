import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { resolveCtaCardHrefs } from "../docs-link-rewrite";
import { ctaIcons, docsComponents } from "../mdx-registry";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, "../../content");

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

function listMdx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMdx(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

describe("CTACards", () => {
  it("renders a link for every card in the cards prop", () => {
    const markup = renderToStaticMarkup(<CTACards columns={2} cards={cards} />);

    for (const card of cards) {
      expect(markup).toContain(card.href);
      expect(markup).toContain(card.title);
      expect(markup).toContain(card.description);
    }
  });

  it("renders each description through the Card description prop", () => {
    // Children land in Card's generic trailing <div>; the `description`
    // prop lands in the <p> the rest of the docs card grids style.
    const markup = renderToStaticMarkup(<CTACards cards={cards} />);

    expect(markup).toMatch(
      /<p[^>]*>The agent pauses and your approval UI resumes the run\.<\/p>/,
    );
  });

  it("stacks to one column below the sm breakpoint", () => {
    // An inline `grid-template-columns` cannot be overridden by a class,
    // so a fixed inline template would keep two columns on a phone.
    const twoUp = renderToStaticMarkup(<CTACards columns={2} cards={cards} />);

    expect(twoUp).toContain("grid-cols-1 sm:grid-cols-2");
    expect(twoUp).not.toContain("grid-template-columns");
  });

  it("honors the columns prop", () => {
    const oneUp = renderToStaticMarkup(<CTACards columns={1} cards={cards} />);

    expect(oneUp).toContain("grid-cols-1");
    expect(oneUp).not.toContain("sm:grid-cols-2");
  });

  it("still wraps children when no cards prop is supplied", () => {
    const markup = renderToStaticMarkup(
      <CTACards>
        <span>legacy child</span>
      </CTACards>,
    );

    expect(markup).toContain("legacy child");
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

describe("CTACards iconKey coverage", () => {
  it("has an icon registered for every iconKey used in content", () => {
    const used = new Set<string>();

    for (const file of listMdx(CONTENT_DIR)) {
      const text = readFileSync(file, "utf8");
      // Only iconKeys inside a <CTACards ...> block; other components
      // resolve iconKey against `customIcons` instead.
      for (const block of text.match(/<CTACards[\s\S]*?\/>/g) ?? []) {
        for (const match of block.matchAll(/iconKey:\s*"([^"]+)"/g)) {
          used.add(match[1]);
        }
      }
    }

    expect(used.size).toBeGreaterThan(0);
    expect(
      [...used].filter((key) => !Object.hasOwn(ctaIcons, key)).sort(),
    ).toEqual([]);
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

// The unit tests above call the component directly, which is exactly the
// blind spot that let the original stub ship: on the real page the MDX
// runs through next-mdx-remote, whose `blockJS` default DELETES every
// JSX attribute whose value is an expression. `cards={[...]}` never
// reached the component. Compile the authored source the way
// `docs-page-view.tsx` does and assert the cards survive the pipeline.
describe("CTACards through the MDX pipeline", () => {
  const HITL_PAGES = [
    "docs/integrations/crewai-flows/human-in-the-loop/index.mdx",
    "docs/integrations/mastra/human-in-the-loop/index.mdx",
    "docs/integrations/microsoft-agent-framework/human-in-the-loop/index.mdx",
    "docs/integrations/pydantic-ai/human-in-the-loop/index.mdx",
  ];

  async function renderMdx(source: string): Promise<string> {
    const { content } = await compileMDX({
      source,
      components: { ...docsComponents },
      options: {
        blockJS: false,
        mdxOptions: { remarkPlugins: [remarkGfm] },
      },
    });
    return renderToStaticMarkup(content);
  }

  it("passes cards and columns through a compile", async () => {
    const markup = await renderMdx(
      '<CTACards columns={1} cards={[{ iconKey: "share2", title: "Flow-based", href: "/human-in-the-loop/flow" }]} />',
    );

    expect(markup).toContain("Flow-based");
    expect(markup).toContain("/human-in-the-loop/flow");
    expect(markup).toContain("grid-cols-1");
  });

  it.each(HITL_PAGES)("renders every card authored by %s", async (page) => {
    const source = readFileSync(resolve(CONTENT_DIR, page), "utf8").replace(
      /^---[\s\S]*?---\n?/,
      "",
    );
    const block = source.match(/<CTACards[\s\S]*?\/>/)?.[0];
    expect(block).toBeDefined();

    const hrefs = [...block!.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    const titles = [...block!.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);

    const markup = await renderMdx(block!);
    for (const href of hrefs) expect(markup).toContain(`href="${href}"`);
    for (const title of titles) expect(markup).toContain(title);
  });
});
