import type { StaticSuggestionsConfig } from "@copilotkit/angular";

const OBSERVATIONAL_MEMORY_PROJECT_BRIEF = `Here is a lot of context about my project. I'm building a B2B analytics platform called Northwind Insights. The core product is a dashboard that ingests events from our customers' web and mobile apps, runs them through a streaming pipeline, and surfaces funnels, retention cohorts, and revenue attribution. Our stack is a Next.js frontend, a Node.js ingestion service behind an API gateway, Kafka for the event bus, ClickHouse for the analytical store, and Postgres for application metadata. We deploy on AWS with EKS, and we use Terraform for infra. The team is eight engineers split across frontend, backend, and data. Our biggest customers are mid-market SaaS companies with fifty to five hundred employees, and our top three by revenue are Acme Retail, Globex, and Initech. Our current north-star metric is weekly active dashboards, and we're at about twelve hundred right now, up from eight hundred last quarter. The main pain points our customers report are slow query times on large date ranges, confusing funnel configuration, and a lack of alerting when metrics move sharply. On the roadmap we have anomaly detection, a self-serve SQL editor, and SSO via SAML. Our pricing is seat-based with a usage overage on event volume, and churn has been creeping up among smaller accounts who find the setup too heavy.

Now, given all of that, summarize the top three product risks you see and suggest one concrete mitigation for each.`;

const OBSERVATIONAL_MEMORY_TRIP_ITINERARY = `I want your help planning a two-week trip, and here's all the context you'll need. I'm traveling from San Francisco in late September with my partner. We both love hiking, good food, and small towns over big cities, and we want to avoid anything too touristy or crowded. Our budget is around six thousand dollars total excluding flights, and we'd prefer to rent a car for at least part of the trip so we have flexibility. We're thinking of northern Italy and the Dolomites, but we're open to Slovenia and Austria too if it makes the route better. My partner is vegetarian, and I have a mild shellfish allergy, so restaurant recommendations should account for that. We like staying in family-run guesthouses rather than large hotels, and we want at least a few days of serious multi-day hiking with hut-to-hut routes. Neither of us speaks Italian or German beyond the basics. We're moderately fit — we can do six to eight hour hiking days but not technical climbing. We'd also like one or two rest days built in around a spa or thermal baths, and we care a lot about scenic drives. We're flying home from wherever makes sense, not necessarily back to the same city.

With all that in mind, sketch a rough two-week itinerary with a suggested base town for each stretch and why.`;

const SUGGESTIONS: Readonly<
  Record<string, StaticSuggestionsConfig["suggestions"]>
> = {
  "beautiful-chat": [
    {
      title: "Pie Chart (Controlled Generative UI)",
      message:
        "Show me a pie chart of our revenue distribution by category. Use the query_data tool to fetch the data first, then render it with the pieChart component.",
    },
    {
      title: "Bar Chart (Controlled Generative UI)",
      message:
        "Show me a bar chart of our expenses by category. Use the query_data tool to fetch the data first, then render it with the barChart component.",
    },
    {
      title: "Schedule Meeting (Human In The Loop)",
      message:
        "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
    },
    {
      title: "Search Flights (A2UI Fixed Schema)",
      message: "Find flights from SFO to JFK for next Tuesday.",
    },
    {
      title: "Sales Dashboard (A2UI Dynamic)",
      message:
        "First use the query_data tool to fetch the financial sales data, then using A2UI, show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
    },
    {
      title: "Excalidraw Diagram (MCP App)",
      message:
        "Use Excalidraw to create a simple network diagram showing a router connected to two switches, each connected to two computers.",
    },
    {
      title: "Calculator App (Open Generative UI)",
      message:
        "Using the generateSandboxedUi tool, build a modern calculator with standard buttons plus labeled metric shortcut buttons that insert their values into the display when clicked. Use sample company data.",
    },
    {
      title: "Toggle Theme (Frontend Tools)",
      message: "Toggle the app theme using the toggleTheme tool.",
    },
    {
      title: "Task Manager (Shared State)",
      message:
        "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
    },
  ],
  "shared-state-read-write": [
    { title: "Greet me", message: "Say hi and introduce yourself." },
    {
      title: "Remember something",
      message:
        "Remember that I prefer morning meetings and that I don't eat dairy.",
    },
    {
      title: "Plan a weekend",
      message: "Suggest a weekend plan based on my interests.",
    },
  ],
  "shared-state-read": [
    {
      title: "Create Italian recipe",
      message: "Create a delicious Italian pasta recipe.",
    },
    {
      title: "Make it healthier",
      message: "Make the recipe healthier with more vegetables.",
    },
    {
      title: "Suggest variations",
      message: "Suggest some creative variations of this recipe.",
    },
  ],
  "shared-state-streaming": [
    {
      title: "Write a short poem",
      message: "Write a short poem about autumn leaves.",
    },
    {
      title: "Draft an email",
      message:
        "Draft a polite email declining a meeting next Tuesday afternoon.",
    },
    {
      title: "Explain quantum computing",
      message:
        "Write a 2-paragraph explanation of quantum computing for a curious teenager.",
    },
  ],
  "readonly-state-agent-context": [
    {
      title: "Who am I?",
      message: "What do you know about me from my context?",
    },
    {
      title: "Suggest next steps",
      message: "Based on my recent activity, what should I try next?",
    },
    {
      title: "Plan my morning",
      message:
        "What time is it in my timezone and what should I do for the next hour?",
    },
  ],
  "reasoning-default": [
    {
      title: "Show reasoning",
      message:
        "Explain step by step why the sky appears blue during the day but red at sunset.",
    },
  ],
  "reasoning-custom": [
    {
      title: "Show reasoning",
      message:
        "Explain step by step why the sky appears blue during the day but red at sunset.",
    },
  ],
  "gen-ui-agent": [
    {
      title: "Plan a launch",
      message: "Plan a product launch for a new mobile app.",
    },
    {
      title: "Plan an offsite",
      message: "Organize a three-day engineering team offsite.",
    },
    {
      title: "Research a competitor",
      message:
        "Research our top competitor and summarize their strengths and weaknesses.",
    },
  ],
  subagents: [
    {
      title: "Research and draft",
      message:
        "Research the benefits of remote work and draft a one-paragraph summary.",
    },
  ],
  "background-agents": [
    {
      title: "Research AI agent frameworks",
      message:
        "Kick off deep research on the current landscape of AI agent frameworks.",
    },
    {
      title: "Investigate renewable energy trends",
      message:
        "Kick off deep research on emerging renewable energy trends for 2026.",
    },
  ],
  "observational-memory": [
    {
      title: "Brief my analytics project",
      message: OBSERVATIONAL_MEMORY_PROJECT_BRIEF,
    },
    {
      title: "Plan a two-week trip",
      message: OBSERVATIONAL_MEMORY_TRIP_ITINERARY,
    },
  ],
  "browser-use": [
    {
      title: "Show me the top Hacker News stories",
      message: "Show me the top Hacker News stories right now.",
    },
    {
      title: "Summarize the CopilotKit homepage",
      message: "Read https://www.copilotkit.ai and summarize what it's about.",
    },
  ],
};

/** Return deterministic static suggestions for a canonical showcase feature. */
export function suggestionsConfigForFeature(
  feature: string,
): StaticSuggestionsConfig[] {
  const suggestions = SUGGESTIONS[feature];
  return suggestions
    ? [
        {
          suggestions: [...suggestions],
          available: "always",
          consumerAgentId: feature,
        },
      ]
    : [];
}
