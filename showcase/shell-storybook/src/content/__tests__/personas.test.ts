import { describe, expect, it } from "vitest";

import { resolveDemo } from "../../lib/registry";
import { validatePersonas } from "../../lib/story";
import { ceo } from "../personas/ceo";
import { cto } from "../personas/cto";
import { headOfSales } from "../personas/head-of-sales";
import { marketingLead } from "../personas/marketing-lead";
import { productLead } from "../personas/product-lead";
import { salesTeamMember } from "../personas/sales-team-member";

const personas = [ceo, cto, productLead] as const;
const goToMarketPersonas = [
  marketingLead,
  headOfSales,
  salesTeamMember,
] as const;

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

  it("qualifies the CEO proof claim to complete cells", () => {
    expect(ceo.pages.find(({ slug }) => slug === "what-it-proves")?.body).toBe(
      "A complete Showcase cell connects a capability to an integration and a runnable example. The result is evidence that a customer, partner, or teammate can inspect instead of a slide they have to trust.",
    );
  });

  it("distinguishes CTO generated truth from maintained demo proof", () => {
    expect(cto.pages[0]?.claim).toBe(
      "Generated truth organizes Showcase. Maintained demos provide the proof.",
    );
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

  it.each([
    [
      "langgraph-python",
      "beautiful-chat",
      "https://showcase.copilotkit.ai/integrations/langgraph-python/beautiful-chat/preview",
    ],
    [
      "langgraph-python",
      "gen-ui-tool-based",
      "https://showcase.copilotkit.ai/integrations/langgraph-python/gen-ui-tool-based/preview",
    ],
  ] as const)(
    "resolves $0/$1 to its real preview",
    (integration, demo, previewHref) => {
      expect(() => resolveDemo(integration, demo)).not.toThrow();
      expect(resolveDemo(integration, demo).previewHref).toBe(previewHref);
    },
  );
});

describe("go-to-market personas", () => {
  it.each([
    [marketingLead, "marketing-lead", "Marketing lead"],
    [headOfSales, "head-of-sales", "Head of Sales"],
    [salesTeamMember, "sales-team-member", "Sales team member"],
  ] as const)("$2 has the expected metadata", (persona, slug, name) => {
    expect(persona).toMatchObject({
      slug,
      name,
      group: "go-to-market",
      minutes: 5,
    });
    expect(persona).not.toHaveProperty("systemOwner");
    expect(persona.pages).toHaveLength(5);
  });

  it("passes persona validation", () => {
    expect(() => validatePersonas(goToMarketPersonas)).not.toThrow();
  });

  it.each([
    [
      marketingLead,
      [
        ["story-showcase-tells", "The story Showcase tells"],
        ["replace-claims-with-proof", "Replace claims with proof"],
        ["find-right-demo", "Find the right demo"],
        ["launch-assets-from-truth", "Build launch assets from truth"],
        ["launch-checklist", "Your launch checklist"],
      ],
    ],
    [
      headOfSales,
      [
        ["showcase-in-one-minute", "Showcase in one minute"],
        ["buyer-needs-to-proof", "Match buyer needs to proof"],
        ["focused-demo", "Run a focused demo"],
        ["answer-with-evidence", "Answer with evidence"],
        ["team-playbook", "Your team playbook"],
      ],
    ],
    [
      salesTeamMember,
      [
        ["what-to-say", "What to say"],
        ["choose-right-proof", "Choose the right proof"],
        ["run-demo-safely", "Run the demo safely"],
        ["claim-boundaries", "Know what not to claim"],
        ["right-follow-up", "Send the right follow-up"],
      ],
    ],
  ] as const)("keeps $0.slug pages in the intended order", (persona, pages) => {
    expect(persona.pages.map(({ slug, title }) => [slug, title])).toEqual(
      pages,
    );
  });

  it.each([
    [
      marketingLead,
      ["Confirm the owner", "Rehearse the proof", "Link the canonical page"],
    ],
    [
      headOfSales,
      ["Select core demos", "Name demo owners", "Review claim boundaries"],
    ],
    [
      salesTeamMember,
      ["Send the exact demo", "Add one relevant doc", "Route open questions"],
    ],
  ] as const)(
    "ends $0.slug with the intended action checklist",
    (persona, items) => {
      const finalPage = persona.pages.at(-1);

      expect(finalPage?.composition).toBe("action");
      expect(finalPage?.visual).toEqual({ kind: "checklist", items });
      expect(items.length).toBeGreaterThan(0);
    },
  );

  it.each([
    [marketingLead, ["preview", "story"]],
    [headOfSales, ["preview", "code"]],
    [salesTeamMember, ["preview", "story"]],
  ] as const)(
    "$0.slug links its live proof to a real demo",
    (persona, views) => {
      const integration = "langgraph-python";
      const demo = "beautiful-chat";
      const page = persona.pages.find(
        ({ composition }) => composition === "live-proof",
      );

      expect(page?.visual).toEqual({ kind: "demo", integration, demo });
      expect(page?.resources).toEqual(
        views.map((view) => ({
          kind: "demo",
          integration,
          demo,
          view,
        })),
      );
      expect(() => resolveDemo(integration, demo)).not.toThrow();
    },
  );

  it("keeps both sales paths inside their claim boundaries", () => {
    expect(
      headOfSales.pages.find(({ slug }) => slug === "answer-with-evidence"),
    ).toMatchObject({
      claim:
        "Separate what the demo proves from what still needs confirmation.",
      body: "Point to visible behavior and the exact framework when answering. If the buyer asks about a different integration, deployment shape, or unsupported capability, capture the question and confirm with the owner instead of stretching the demo.",
    });
    expect(
      salesTeamMember.pages.find(({ slug }) => slug === "claim-boundaries"),
    ).toMatchObject({
      claim: "Say what you saw. Confirm what you did not.",
      body: "A demo proves the visible behavior in the named integration. It does not automatically prove every framework, production architecture, or roadmap commitment. Write down unanswered questions and route them to the right owner.",
    });
  });
});
