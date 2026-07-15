import type { Persona } from "../types";

export const productLead = {
  slug: "product-lead",
  name: "Product lead",
  group: "leadership",
  summary:
    "Use live evidence to understand coverage, gaps, and product priorities.",
  question: "What does Showcase prove about the product today?",
  minutes: 6,
  pages: [
    {
      slug: "showcase-is-product-map",
      title: "Showcase is the product map",
      claim: "Showcase turns capabilities into a map you can inspect.",
      body: "Instead of asking whether a feature exists in the abstract, start with the capability and see where it is demonstrated. Showcase makes the product surface visible across integrations without pretending every cell has equal maturity.",
      composition: "statement",
      visual: {
        kind: "illustration",
        concept: "audience",
        alt: "One product system revealing different capability views.",
      },
      resources: [
        { kind: "curated", id: "coverage-matrix" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
    {
      slug: "see-coverage",
      title: "See coverage without guessing",
      claim: "Coverage shows where product intent has working evidence.",
      body: "The matrix connects features and integrations. It helps you see breadth, concentration, and missing proof. Read it as a conversation starter, then open the underlying demo before treating a cell as product truth.",
      composition: "artifact",
      visual: { kind: "coverage-map" },
      resources: [
        { kind: "curated", id: "coverage-matrix" },
        { kind: "curated", id: "showcase-dashboard" },
      ],
    },
    {
      slug: "watch-product-work",
      title: "Watch the product work",
      claim: "The fastest product review starts with the behavior.",
      body: "Open a focused demo and try the interaction yourself. A small example makes product behavior, UX constraints, and integration differences easier to discuss than a long requirements document.",
      composition: "live-proof",
      visual: {
        kind: "demo",
        integration: "langgraph-python",
        demo: "gen-ui-tool-based",
      },
      resources: [
        {
          kind: "demo",
          integration: "langgraph-python",
          demo: "gen-ui-tool-based",
          view: "preview",
        },
        {
          kind: "demo",
          integration: "langgraph-python",
          demo: "gen-ui-tool-based",
          view: "code",
        },
      ],
    },
    {
      slug: "read-gaps-honestly",
      title: "Read gaps honestly",
      claim: "A missing or partial cell is useful information.",
      body: "A gap can mean the product is not supported, the integration is not implemented, the demo is missing, or proof is stale. Separate those cases before turning the matrix into a roadmap claim.",
      composition: "artifact",
      visual: { kind: "artifact", artifact: "cell-states" },
      resources: [
        { kind: "curated", id: "showcase-dashboard" },
        { kind: "curated", id: "showcase-rules" },
      ],
    },
    {
      slug: "evidence-into-priorities",
      title: "Turn evidence into priorities",
      claim:
        "Prioritize the gap behind the business need, not the emptiest row.",
      body: "Combine customer demand, strategic integrations, product direction, and maintenance cost. Showcase supplies evidence, but it does not choose the roadmap. Use it to make tradeoffs explicit and to define the proof required for done.",
      composition: "diagram",
      visual: { kind: "proof-flow" },
      resources: [
        { kind: "curated", id: "coverage-matrix" },
        { kind: "curated", id: "showcase-docs" },
      ],
    },
    {
      slug: "product-cadence",
      title: "Your product cadence",
      claim: "Use Showcase before planning, review, and launch.",
      body: "Start product reviews from a live example, inspect strategic gaps during planning, and require an updated proof link when a capability ships. This creates a small recurring habit instead of a separate documentation project.",
      composition: "action",
      visual: {
        kind: "checklist",
        items: [
          "Open proof in product review",
          "Name strategic gaps in planning",
          "Require a launch proof link",
        ],
      },
      resources: [
        { kind: "curated", id: "showcase-home" },
        { kind: "curated", id: "showcase-dashboard" },
      ],
    },
  ],
} satisfies Persona;
