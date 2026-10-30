/**
 * The eval suite: requests a composer should answer with a surface, and the
 * components a good answer uses. Each `expect` entry is a group of
 * alternatives; a surface scores the share of groups it covers (macros count
 * as written, before they expand). Add tasks here; `pnpm evals` runs them all.
 */
export type EvalTask = { id: string; prompt: string; expect: string[][] };

export const EVAL_TASKS: EvalTask[] = [
  {
    id: "sales-dashboard",
    prompt: "Q3 sales by region as a dashboard",
    expect: [
      ["Stat", "StatGroup"],
      ["BarChart", "Chart", "LineChart", "AreaChart", "PieChart"],
    ],
  },
  {
    id: "headphones",
    prompt: "Compare three noise-cancelling headphones",
    expect: [["ProductCard", "ComparisonTable", "EntityCard"]],
  },
  {
    id: "flights",
    prompt: "Show three flight options from SFO to JFK on Friday",
    expect: [["FlightCard"]],
  },
  {
    id: "weather",
    prompt: "What's the weather in Lisbon this week?",
    expect: [["WeatherReport", "WeatherCard"]],
  },
  {
    id: "signup",
    prompt: "A signup form with name, email and a plan choice",
    expect: [
      ["TextField"],
      [
        "RadioGroup",
        "Select",
        "ChoicePicker",
        "SegmentedControl",
        "ChipSelect",
      ],
      ["Button"],
    ],
  },
  {
    id: "tokyo",
    prompt: "Plan a 3-day Tokyo trip with a map",
    expect: [
      ["MapView", "Map", "RouteMap", "PlaceList"],
      ["Timeline", "Agenda", "Tabs", "Accordion", "PlaceList"],
    ],
  },
  {
    id: "recipe",
    prompt: "A recipe for shakshuka for two",
    expect: [["RecipeCard"]],
  },
  {
    id: "team",
    prompt: "Our 4-person design team with roles and locations",
    expect: [["ProfileCard", "Avatar", "AvatarGroup", "EntityCard"]],
  },
  {
    id: "receipt",
    prompt: "The receipt for my order of 3 items",
    expect: [["ReceiptCard"]],
  },
  {
    id: "agenda",
    prompt: "A one-day conference agenda with 6 talks",
    expect: [["Agenda", "Timeline"]],
  },
  {
    id: "kpi",
    prompt: "Our NPS is 62, up 5 points. Show it.",
    expect: [["Gauge", "RadialProgress", "Stat"]],
  },
  {
    id: "code",
    prompt: "Explain debounce in TypeScript with a code sample",
    expect: [["CodeBlock", "Code"]],
  },
];
