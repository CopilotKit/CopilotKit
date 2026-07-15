import type { Persona } from "../types";

export const headOfSales = {
  slug: "head-of-sales",
  name: "Head of Sales",
  group: "go-to-market",
  summary: "Give the team a focused, evidence-backed demo playbook.",
  question: "How should the team match buyer needs to proof?",
  minutes: 5,
  pages: [
    {
      slug: "showcase-in-one-minute",
      title: "Showcase in one minute",
      claim:
        "Showcase is the proof library for CopilotKit across agent frameworks.",
      body: "It gives the team working examples that connect buyer needs to CopilotKit capabilities and the frameworks buyers already use. The value is a credible, focused conversation, not a tour of every demo.",
      composition: "statement",
      visual: {
        kind: "illustration",
        concept: "audience",
        alt: "One technical system translated for several buyer conversations.",
      },
      resources: [
        { kind: "curated", id: "showcase-home" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
    {
      slug: "buyer-needs-to-proof",
      title: "Match buyer needs to proof",
      claim:
        "Start with the buyer's need, then choose the capability and framework.",
      body: "Ask what the buyer wants the agent experience to do and which stack they use. Showcase helps the team find a relevant example without turning the discovery call into a feature checklist.",
      composition: "diagram",
      visual: {
        kind: "illustration",
        concept: "ecosystem",
        alt: "Buyer needs connecting to capabilities and framework-specific proof.",
      },
      resources: [
        { kind: "curated", id: "coverage-matrix" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
    {
      slug: "focused-demo",
      title: "Run a focused demo",
      claim: "One prepared proof beats five improvised tabs.",
      body: "Choose a stable example, state what the buyer should notice, run the shortest successful interaction, and stop. Use the code or docs only when the conversation calls for more depth.",
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
          view: "code",
        },
      ],
    },
    {
      slug: "answer-with-evidence",
      title: "Answer with evidence",
      claim:
        "Separate what the demo proves from what still needs confirmation.",
      body: "Point to visible behavior and the exact framework when answering. If the buyer asks about a different integration, deployment shape, or unsupported capability, capture the question and confirm with the owner instead of stretching the demo.",
      composition: "artifact",
      visual: { kind: "artifact", artifact: "claim-boundary" },
      resources: [
        { kind: "curated", id: "showcase-docs" },
        { kind: "curated", id: "showcase-dashboard" },
      ],
    },
    {
      slug: "team-playbook",
      title: "Your team playbook",
      claim: "Give the team a small, maintained demo menu.",
      body: "Assign an owner to each recommended demo, rehearse the happy path, record the claim boundary, and review the menu when product or integration behavior changes.",
      composition: "action",
      visual: {
        kind: "checklist",
        items: [
          "Select core demos",
          "Name demo owners",
          "Review claim boundaries",
        ],
      },
      resources: [
        { kind: "curated", id: "integration-directory" },
        { kind: "curated", id: "showcase-dashboard" },
      ],
    },
  ],
} satisfies Persona;
