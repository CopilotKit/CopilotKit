/** Canonical LGP controls. Every framework executes these exact public actions. */
import type { PillAction } from "../helpers/conversation-runner.js";

export function immediatePill(
  id: string,
  buttonName: string,
  prompt: string,
): PillAction {
  return {
    kind: "pill",
    id,
    buttonName,
    expectedDispatchedPrompt: prompt,
    submission: { kind: "immediate" },
  };
}

export const BEAUTIFUL_PILLS = {
  "pie-chart": immediatePill(
    "beautiful-pie-chart",
    "Pie Chart (Controlled Generative UI)",
    "Show me a pie chart of our revenue distribution by category. Use the query_data tool to fetch the data first, then render it with the pieChart component.",
  ),
  "bar-chart": immediatePill(
    "beautiful-bar-chart",
    "Bar Chart (Controlled Generative UI)",
    "Show me a bar chart of our expenses by category. Use the query_data tool to fetch the data first, then render it with the barChart component.",
  ),
  "schedule-meeting": immediatePill(
    "beautiful-schedule-meeting",
    "Schedule Meeting (Human In The Loop)",
    "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
  ),
  "search-flights": immediatePill(
    "beautiful-search-flights",
    "Search Flights (A2UI Fixed Schema)",
    "Find flights from SFO to JFK for next Tuesday.",
  ),
  "toggle-theme": immediatePill(
    "beautiful-toggle-theme",
    "Toggle Theme (Frontend Tools)",
    "Toggle the app theme using the toggleTheme tool.",
  ),
} as const;

export const BEAUTIFUL_EXTRA_PILLS = {
  "sales-dashboard": immediatePill(
    "beautiful-sales-dashboard",
    "Sales Dashboard (A2UI Dynamic)",
    "First use the query_data tool to fetch the financial sales data, then using A2UI, show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
  ),
  excalidraw: immediatePill(
    "beautiful-excalidraw",
    "Excalidraw Diagram (MCP App)",
    "Use Excalidraw to create a simple network diagram showing a router connected to two switches, each connected to two computers.",
  ),
  calculator: immediatePill(
    "beautiful-calculator",
    "Calculator App (Open Generative UI)",
    "Using the generateSandboxedUi tool, build a modern calculator with standard buttons plus labeled metric shortcut buttons that insert their values into the display when clicked. Use sample company data.",
  ),
  "task-manager": immediatePill(
    "beautiful-task-manager",
    "Task Manager (Shared State)",
    "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
  ),
} as const;

export const BEAUTIFUL_ROUTE_ACTIONS = [
  BEAUTIFUL_PILLS["pie-chart"],
  BEAUTIFUL_PILLS["bar-chart"],
  BEAUTIFUL_PILLS["schedule-meeting"],
  BEAUTIFUL_PILLS["search-flights"],
  BEAUTIFUL_EXTRA_PILLS["sales-dashboard"],
  BEAUTIFUL_EXTRA_PILLS.excalidraw,
  BEAUTIFUL_EXTRA_PILLS.calculator,
  BEAUTIFUL_PILLS["toggle-theme"],
  BEAUTIFUL_EXTRA_PILLS["task-manager"],
] as const;

export const BEAUTIFUL_INVENTORY = [
  "Pie Chart (Controlled Generative UI)",
  "Bar Chart (Controlled Generative UI)",
  "Schedule Meeting (Human In The Loop)",
  "Search Flights (A2UI Fixed Schema)",
  "Sales Dashboard (A2UI Dynamic)",
  "Excalidraw Diagram (MCP App)",
  "Calculator App (Open Generative UI)",
  "Toggle Theme (Frontend Tools)",
  "Task Manager (Shared State)",
] as const;

export const HEADLESS_SIMPLE_PILLS = [
  {
    action: immediatePill(
      "headless-hello",
      "Say hello in one short sentence.",
      "Say hello in one short sentence.",
    ),
    reply:
      "Hi! In one short sentence: I'm a CopilotKit demo agent here to help you try features.",
  },
  {
    action: immediatePill(
      "headless-joke",
      "Tell me a one-line joke.",
      "Tell me a one-line joke.",
    ),
    reply:
      "Why did the scarecrow win an award? Because he was outstanding in his field!",
  },
  {
    action: immediatePill(
      "headless-fact",
      "Give me a fun fact.",
      "Give me a fun fact.",
    ),
    reply:
      "A fun fact: Honey never spoils! Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly edible.",
  },
] as const;

export const HEADLESS_COMPLETE_PILLS = [
  {
    id: "weather",
    sample: "What's the weather in Tokyo?",
    title: "Weather",
    prompt: "What's the weather in Tokyo?",
    selector: '[data-testid="headless-weather-card"]',
    values: ["Tokyo", "Sunny", "68°F"],
  },
  {
    id: "stock",
    sample: "What's AAPL trading at?",
    title: "Stock price",
    prompt: "What's the price of AAPL right now?",
    selector: '[data-testid="headless-stock-card"]',
    values: ["AAPL", "$189.42", "+1.27%"],
  },
  {
    id: "highlight",
    sample: "Highlight: ship the demo on Friday",
    title: "Highlight a note",
    prompt: "Highlight this note for me: 'ship the demo on Friday'.",
    selector: '[data-testid="headless-highlight-card"]',
    values: ["ship the demo on Friday"],
  },
  {
    id: "revenue",
    sample: "Show me a chart of revenue over the last six months",
    title: "Revenue chart",
    prompt: "Show me a chart of revenue over the last six months.",
    selector: '[data-testid="headless-revenue-chart"]',
    values: ["Quarterly revenue", "Last six months · USD thousands"],
  },
] as const;

export const BEAUTIFUL_BAR_VALUES = [
  { label: "Rent", value: 15000 },
  { label: "Salaries", value: 80000 },
  { label: "Marketing", value: 12000 },
  { label: "Travel", value: 5000 },
] as const;
export const HEADLESS_REVENUE_VALUES = [
  { label: "Jan", value: 38 },
  { label: "Feb", value: 47 },
  { label: "Mar", value: 52 },
  { label: "Apr", value: 49 },
  { label: "May", value: 63 },
  { label: "Jun", value: 71 },
] as const;
