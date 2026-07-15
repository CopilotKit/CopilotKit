import type { Persona } from "../types";

export const ceo = {
  slug: "ceo",
  name: "CEO",
  group: "leadership",
  summary: "See why Showcase is shared company infrastructure.",
  question: "How does Showcase turn ecosystem breadth into company leverage?",
  minutes: 4,
  pages: [
    {
      slug: "why-showcase-exists",
      title: "Why Showcase exists",
      claim: "Showcase turns a broad platform into something people can see.",
      body: "CopilotKit works across frameworks, features, and product surfaces. That breadth is valuable, but hard to hold in one conversation. Showcase makes the platform concrete through a consistent library of real, working examples.",
      composition: "statement",
      visual: {
        kind: "illustration",
        concept: "audience",
        alt: "One technical system viewed through several role-specific lenses.",
      },
      resources: [
        { kind: "curated", id: "showcase-home" },
        { kind: "curated", id: "integration-directory" },
      ],
    },
    {
      slug: "what-it-proves",
      title: "What it proves",
      claim: "A working demo is stronger than a promise.",
      body: "A complete Showcase cell connects a capability to an integration and a runnable example. The result is evidence that a customer, partner, or teammate can inspect instead of a slide they have to trust.",
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
      slug: "how-showcase-compounds",
      title: "How Showcase compounds",
      claim: "One system supports product, ecosystem, sales, and launch work.",
      body: "The same maintained example can support a partner review, a sales demo, a launch asset, and an engineering regression check. Better shared proof reduces duplicate work and keeps the company's story closer to the product.",
      composition: "diagram",
      visual: {
        kind: "illustration",
        concept: "ecosystem",
        alt: "Distinct framework modules feeding one shared proof system.",
      },
      resources: [
        { kind: "curated", id: "coverage-matrix" },
        { kind: "curated", id: "showcase-dashboard" },
      ],
    },
    {
      slug: "decisions-only-you-can-make",
      title: "Decisions only you can make",
      claim: "Protect Showcase as shared company infrastructure.",
      body: "Ask leaders to use Showcase as the default proof layer, fund the owner time that keeps it trustworthy, and resolve priority conflicts when a strategic capability or integration has no convincing evidence.",
      composition: "action",
      visual: {
        kind: "checklist",
        items: [
          "Name Showcase in the operating cadence",
          "Fund shared maintenance",
          "Escalate strategic coverage gaps",
        ],
      },
      resources: [
        { kind: "curated", id: "showcase-dashboard" },
        { kind: "curated", id: "showcase-source" },
      ],
    },
  ],
} satisfies Persona;
