import type { StaticSuggestionsConfig } from "@copilotkit/angular";

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
