import { describe, expect, it } from "vitest";

import { validatePersonas } from "../../lib/story";
import { ceo } from "../personas/ceo";
import { cto } from "../personas/cto";
import { productLead } from "../personas/product-lead";

const personas = [ceo, cto, productLead] as const;

describe("leadership personas", () => {
  it.each([
    [ceo, "ceo", "CEO", 4, 4],
    [cto, "cto", "CTO", 6, 6],
    [productLead, "product-lead", "Product lead", 6, 6],
  ] as const)(
    "$2 has the expected metadata",
    (persona, slug, name, minutes, pageCount) => {
      expect(persona).toMatchObject({
        slug,
        name,
        group: "leadership",
        minutes,
      });
      expect(persona).not.toHaveProperty("systemOwner");
      expect(persona.pages).toHaveLength(pageCount);
    },
  );

  it("passes persona validation", () => {
    expect(() => validatePersonas(personas)).not.toThrow();
  });

  it.each([
    [
      ceo,
      [
        ["why-showcase-exists", "Why Showcase exists"],
        ["what-it-proves", "What it proves"],
        ["how-showcase-compounds", "How Showcase compounds"],
        ["decisions-only-you-can-make", "Decisions only you can make"],
      ],
    ],
    [
      cto,
      [
        ["system-in-one-picture", "The system in one picture"],
        ["manifest-to-live-demo", "From manifest to live demo"],
        ["trustworthy-proof", "How proof becomes trustworthy"],
        ["where-system-runs", "Where the system runs"],
        ["who-owns-each-seam", "Who owns each seam"],
        ["technical-operating-view", "Your technical operating view"],
      ],
    ],
    [
      productLead,
      [
        ["showcase-is-product-map", "Showcase is the product map"],
        ["see-coverage", "See coverage without guessing"],
        ["watch-product-work", "Watch the product work"],
        ["read-gaps-honestly", "Read gaps honestly"],
        ["evidence-into-priorities", "Turn evidence into priorities"],
        ["product-cadence", "Your product cadence"],
      ],
    ],
  ] as const)("keeps $0.slug pages in the intended order", (persona, pages) => {
    expect(persona.pages.map(({ slug, title }) => [slug, title])).toEqual(
      pages,
    );
  });

  it.each([
    [
      ceo,
      [
        "Name Showcase in the operating cadence",
        "Fund shared maintenance",
        "Escalate strategic coverage gaps",
      ],
    ],
    [
      cto,
      [
        "Review owner boundaries quarterly",
        "Require proof for strategic coverage",
        "Fund reliability work",
      ],
    ],
    [
      productLead,
      [
        "Open proof in product review",
        "Name strategic gaps in planning",
        "Require a launch proof link",
      ],
    ],
  ] as const)(
    "ends $0.slug with a nonempty action checklist",
    (persona, items) => {
      const finalPage = persona.pages.at(-1);

      expect(finalPage?.composition).toBe("action");
      expect(finalPage?.visual).toEqual({ kind: "checklist", items });
      expect(items.length).toBeGreaterThan(0);
    },
  );

  it.each([
    [ceo, "langgraph-python", "beautiful-chat"],
    [productLead, "langgraph-python", "gen-ui-tool-based"],
  ] as const)(
    "$0.slug links its live proof to a real demo",
    (persona, integration, demo) => {
      const page = persona.pages.find(
        ({ composition }) => composition === "live-proof",
      );

      expect(page?.visual).toEqual({ kind: "demo", integration, demo });
      expect(page?.resources).toEqual([
        { kind: "demo", integration, demo, view: "preview" },
        { kind: "demo", integration, demo, view: "code" },
      ]);
    },
  );
});
