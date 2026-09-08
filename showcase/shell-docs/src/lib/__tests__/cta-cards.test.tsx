import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
    href: "/microsoft-agent-framework/human-in-the-loop/interrupt-flow",
  },
  {
    iconKey: "share2",
    title: "Tool-based",
    description: "A frontend tool renders UI and waits for the user.",
    href: "/microsoft-agent-framework/human-in-the-loop/tool-based",
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

  it("honors the columns prop in the grid template", () => {
    expect(
      renderToStaticMarkup(<CTACards columns={1} cards={cards} />),
    ).toContain("repeat(1, 1fr)");
    expect(
      renderToStaticMarkup(<CTACards columns={2} cards={cards} />),
    ).toContain("repeat(2, 1fr)");
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
    expect([...used].filter((key) => !(key in ctaIcons)).sort()).toEqual([]);
  });
});
