import type { Persona } from "../types";

export const marketingLead = {
  slug: "marketing-lead",
  name: "Marketing lead",
  group: "go-to-market",
  summary: "Turn maintained demos into credible launch stories.",
  question: "Which proof best supports the message we need to tell?",
  minutes: 5,
  pages: [
    {
      slug: "story-showcase-tells",
      title: "The story Showcase tells",
      claim: "Showcase says CopilotKit works across the agent ecosystem.",
      body: "The story is not a list of logos. It is a growing set of comparable, working examples that show how CopilotKit capabilities appear across real agent frameworks.",
      composition: "statement",
      visual: {
        kind: "illustration",
        concept: "ecosystem",
        alt: "Distinct framework modules joining one consistent Showcase system.",
      },
      resources: [
        { kind: "curated", id: "integration-directory" },
        { kind: "curated", id: "showcase-home" },
      ],
    },
    {
      slug: "replace-claims-with-proof",
      title: "Replace claims with proof",
      claim: "Lead with the behavior, then explain the benefit.",
      body: "A live example gives an audience something specific to understand. Use the interaction as the anchor, describe the customer value in plain language, and link back to the exact proof after the campaign.",
      composition: "live-proof",
      visual: {
        kind: "demo",
        integration: "langgraph-python",
        demo: "beautiful-chat",
      },
      resources: [
        {
          kind: "demo",
          integration: "langgraph-python",
          demo: "beautiful-chat",
          view: "preview",
        },
        {
          kind: "demo",
          integration: "langgraph-python",
          demo: "beautiful-chat",
          view: "story",
        },
      ],
    },
    {
      slug: "find-right-demo",
      title: "Find the right demo",
      claim: "Choose one demo that matches the message.",
      body: "Start with the capability you are announcing, then choose a stable integration your audience recognizes. Avoid a broad tour. One short path with a clear result is easier to trust and easier to reuse.",
      composition: "artifact",
      visual: { kind: "artifact", artifact: "demo-picker" },
      resources: [
        { kind: "curated", id: "integration-directory" },
        { kind: "curated", id: "coverage-matrix" },
      ],
    },
    {
      slug: "launch-assets-from-truth",
      title: "Build launch assets from truth",
      claim: "Build launch assets from the maintained example.",
      body: "Capture the approved demo, link the canonical page, and keep claims inside what the interaction proves. When the example changes, the source and owner make it possible to update the asset without guessing.",
      composition: "diagram",
      visual: { kind: "proof-flow" },
      resources: [
        { kind: "curated", id: "showcase-source" },
        { kind: "curated", id: "showcase-docs" },
      ],
    },
    {
      slug: "launch-checklist",
      title: "Your launch checklist",
      claim: "Every launch needs one owner, one proof, and one follow-up link.",
      body: "Confirm the demo with its owner, rehearse the exact interaction, capture only supported claims, and give the audience a durable place to explore after the announcement.",
      composition: "action",
      visual: {
        kind: "checklist",
        items: [
          "Confirm the owner",
          "Rehearse the proof",
          "Link the canonical page",
        ],
      },
      resources: [
        { kind: "curated", id: "showcase-home" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
  ],
} satisfies Persona;
