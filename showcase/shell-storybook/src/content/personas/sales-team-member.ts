import type { Persona } from "../types";

export const salesTeamMember = {
  slug: "sales-team-member",
  name: "Sales team member",
  group: "go-to-market",
  summary: "Prepare and run one safe, relevant demo journey.",
  question: "What should I say, show, and send after the call?",
  minutes: 5,
  pages: [
    {
      slug: "what-to-say",
      title: "What to say",
      claim:
        "CopilotKit brings agent capabilities into the product experience across frameworks.",
      body: "Use Showcase to make that sentence concrete. Start with the buyer's desired experience, then show one working example in a framework that matters to them.",
      composition: "statement",
      visual: {
        kind: "illustration",
        concept: "audience",
        alt: "A single Showcase system translated into a buyer-ready explanation.",
      },
      resources: [
        { kind: "curated", id: "showcase-home" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
    {
      slug: "choose-right-proof",
      title: "Choose the right proof",
      claim: "Match need, framework, and demo before the call.",
      body: "Pick the capability first, confirm the buyer's stack, and choose one working cell. Open it before the meeting and keep a second option only when there is a clear reason.",
      composition: "artifact",
      visual: { kind: "artifact", artifact: "demo-picker" },
      resources: [
        { kind: "curated", id: "coverage-matrix" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
    {
      slug: "run-demo-safely",
      title: "Run the demo safely",
      claim: "Tell the audience what to watch, then run the shortest path.",
      body: "Load the canonical page early, describe the expected result, complete one interaction, and keep the direct link ready. If the preview is slow, open it directly instead of narrating around a blank frame.",
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
      slug: "claim-boundaries",
      title: "Know what not to claim",
      claim: "Say what you saw. Confirm what you did not.",
      body: "A demo proves the visible behavior in the named integration. It does not automatically prove every framework, production architecture, or roadmap commitment. Write down unanswered questions and route them to the right owner.",
      composition: "artifact",
      visual: { kind: "artifact", artifact: "claim-boundary" },
      resources: [
        { kind: "curated", id: "showcase-docs" },
        { kind: "curated", id: "showcase-dashboard" },
      ],
    },
    {
      slug: "right-follow-up",
      title: "Send the right follow-up",
      claim: "Send the exact proof and the next useful resource.",
      body: "After the call, share the canonical demo page, the most relevant docs page, and any question that still needs an owner. Avoid sending the whole gallery without context.",
      composition: "action",
      visual: {
        kind: "checklist",
        items: [
          "Send the exact demo",
          "Add one relevant doc",
          "Route open questions",
        ],
      },
      resources: [
        { kind: "curated", id: "showcase-home" },
        { kind: "curated", id: "showcase-docs" },
      ],
    },
  ],
} satisfies Persona;
