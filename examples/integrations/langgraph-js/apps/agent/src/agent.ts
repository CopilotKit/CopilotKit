/**
 * CopilotKit + LangGraph TypeScript integration demo agent.
 * Mirrors the north star Python agent using createAgent + copilotkitMiddleware.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { tool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";

// --- State schema (matches north star's AgentState) ---

const TodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  status: z.enum(["pending", "completed"]),
});

const stateSchema = z.object({
  todos: z.array(TodoSchema).default([]),
});

// --- CSV data (inlined) ---

const csvData = [
  {
    date: "2026-01-05",
    category: "Revenue",
    subcategory: "Enterprise Subscriptions",
    amount: 45000,
    type: "income",
    notes: "3 new enterprise customers (Acme Corp, TechFlow, DataViz Inc)",
  },
  {
    date: "2026-01-05",
    category: "Revenue",
    subcategory: "Pro Tier Upgrades",
    amount: 12000,
    type: "income",
    notes: "24 users upgraded from free to pro",
  },
  {
    date: "2026-01-08",
    category: "Revenue",
    subcategory: "API Usage Overages",
    amount: 3500,
    type: "income",
    notes: "High API usage from top 5 customers",
  },
  {
    date: "2026-01-10",
    category: "Expenses",
    subcategory: "Engineering Salaries",
    amount: 42000,
    type: "expense",
    notes: "7 engineers + 2 contractors",
  },
  {
    date: "2026-01-10",
    category: "Expenses",
    subcategory: "Product Team",
    amount: 18000,
    type: "expense",
    notes: "PM and 2 designers",
  },
  {
    date: "2026-01-12",
    category: "Expenses",
    subcategory: "AWS Infrastructure",
    amount: 8200,
    type: "expense",
    notes: "Increased compute for new AI features",
  },
  {
    date: "2026-01-15",
    category: "Expenses",
    subcategory: "Marketing - Paid Ads",
    amount: 12000,
    type: "expense",
    notes: "Google Ads and LinkedIn campaigns",
  },
  {
    date: "2026-01-18",
    category: "Revenue",
    subcategory: "Consulting Services",
    amount: 8500,
    type: "income",
    notes: "Custom integration for Acme Corp",
  },
  {
    date: "2026-01-20",
    category: "Expenses",
    subcategory: "Customer Success",
    amount: 15000,
    type: "expense",
    notes: "3 CSMs + support tools (Intercom)",
  },
  {
    date: "2026-01-22",
    category: "Expenses",
    subcategory: "AI Model Costs",
    amount: 4200,
    type: "expense",
    notes: "OpenAI API usage for product features",
  },
  {
    date: "2026-01-25",
    category: "Revenue",
    subcategory: "Marketplace Sales",
    amount: 6800,
    type: "income",
    notes: "Template and plugin sales",
  },
  {
    date: "2026-01-28",
    category: "Expenses",
    subcategory: "Office & Equipment",
    amount: 3500,
    type: "expense",
    notes: "New laptops and coworking spaces",
  },
  {
    date: "2026-02-03",
    category: "Revenue",
    subcategory: "Enterprise Subscriptions",
    amount: 51000,
    type: "income",
    notes: "2 new customers + expansion from TechFlow",
  },
  {
    date: "2026-02-03",
    category: "Revenue",
    subcategory: "Pro Tier Upgrades",
    amount: 15500,
    type: "income",
    notes: "31 upgrades + reduced churn",
  },
  {
    date: "2026-02-05",
    category: "Revenue",
    subcategory: "API Usage Overages",
    amount: 4800,
    type: "income",
    notes: "DataViz Inc heavy API usage spike",
  },
  {
    date: "2026-02-07",
    category: "Expenses",
    subcategory: "Engineering Salaries",
    amount: 42000,
    type: "expense",
    notes: "Same headcount as January",
  },
  {
    date: "2026-02-07",
    category: "Expenses",
    subcategory: "Product Team",
    amount: 18000,
    type: "expense",
    notes: "No changes to product team",
  },
  {
    date: "2026-02-10",
    category: "Expenses",
    subcategory: "AWS Infrastructure",
    amount: 9500,
    type: "expense",
    notes: "Traffic spike from viral social post",
  },
  {
    date: "2026-02-12",
    category: "Expenses",
    subcategory: "Marketing - Paid Ads",
    amount: 15000,
    type: "expense",
    notes: "Increased ad spend for Q1 push",
  },
  {
    date: "2026-02-14",
    category: "Revenue",
    subcategory: "Consulting Services",
    amount: 12000,
    type: "income",
    notes: "2 custom projects (TechFlow + new client)",
  },
  {
    date: "2026-02-18",
    category: "Expenses",
    subcategory: "Customer Success",
    amount: 16500,
    type: "expense",
    notes: "Hired 1 additional CSM",
  },
  {
    date: "2026-02-20",
    category: "Expenses",
    subcategory: "AI Model Costs",
    amount: 5800,
    type: "expense",
    notes: "Increased usage from new AI features launch",
  },
  {
    date: "2026-02-22",
    category: "Revenue",
    subcategory: "Marketplace Sales",
    amount: 8200,
    type: "income",
    notes: "Top template hit featured list",
  },
  {
    date: "2026-02-25",
    category: "Expenses",
    subcategory: "Conference & Travel",
    amount: 4500,
    type: "expense",
    notes: "Team attended SaaS Conference 2026",
  },
  {
    date: "2026-02-27",
    category: "Revenue",
    subcategory: "Partnership Revenue",
    amount: 5500,
    type: "income",
    notes: "Referral fees from integration partners",
  },
  {
    date: "2026-03-02",
    category: "Revenue",
    subcategory: "Enterprise Subscriptions",
    amount: 58000,
    type: "income",
    notes: "Major win: Fortune 500 customer signed",
  },
  {
    date: "2026-03-02",
    category: "Revenue",
    subcategory: "Pro Tier Upgrades",
    amount: 19000,
    type: "income",
    notes: "42 upgrades - best month yet",
  },
  {
    date: "2026-03-05",
    category: "Revenue",
    subcategory: "API Usage Overages",
    amount: 6200,
    type: "income",
    notes: "Consistent high usage across top tier",
  },
  {
    date: "2026-03-08",
    category: "Expenses",
    subcategory: "Engineering Salaries",
    amount: 48000,
    type: "expense",
    notes: "Hired 1 senior engineer for AI team",
  },
  {
    date: "2026-03-08",
    category: "Expenses",
    subcategory: "Product Team",
    amount: 21000,
    type: "expense",
    notes: "Promoted designer to senior level",
  },
  {
    date: "2026-03-10",
    category: "Expenses",
    subcategory: "AWS Infrastructure",
    amount: 11000,
    type: "expense",
    notes: "Scaled infrastructure for enterprise client",
  },
  {
    date: "2026-03-12",
    category: "Expenses",
    subcategory: "Marketing - Paid Ads",
    amount: 18000,
    type: "expense",
    notes: "Doubled down on successful campaigns",
  },
  {
    date: "2026-03-14",
    category: "Revenue",
    subcategory: "Consulting Services",
    amount: 15500,
    type: "income",
    notes: "Fortune 500 onboarding + 2 other projects",
  },
  {
    date: "2026-03-16",
    category: "Expenses",
    subcategory: "Customer Success",
    amount: 19500,
    type: "expense",
    notes: "Hired dedicated enterprise CSM",
  },
  {
    date: "2026-03-18",
    category: "Expenses",
    subcategory: "AI Model Costs",
    amount: 7200,
    type: "expense",
    notes: "Fortune 500 client heavy AI usage",
  },
  {
    date: "2026-03-20",
    category: "Revenue",
    subcategory: "Marketplace Sales",
    amount: 9800,
    type: "income",
    notes: "3 new templates in top 10",
  },
  {
    date: "2026-03-22",
    category: "Expenses",
    subcategory: "Sales & BD",
    amount: 12000,
    type: "expense",
    notes: "Hired first sales rep for enterprise",
  },
  {
    date: "2026-03-24",
    category: "Revenue",
    subcategory: "Partnership Revenue",
    amount: 8200,
    type: "income",
    notes: "New integration partnerships launched",
  },
  {
    date: "2026-03-26",
    category: "Expenses",
    subcategory: "Security & Compliance",
    amount: 6500,
    type: "expense",
    notes: "SOC 2 audit and security tools",
  },
  {
    date: "2026-03-28",
    category: "Revenue",
    subcategory: "Training & Workshops",
    amount: 4200,
    type: "income",
    notes: "Conducted 2 customer training sessions",
  },
];

// --- Tools ---

const getWeather = tool(
  async ({ location }) => {
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
    const geocodingRes = await fetch(geocodingUrl);
    const geocodingData = await geocodingRes.json();

    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${location}' not found`);
    }

    const { latitude, longitude, name } = geocodingData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;
    const weatherRes = await fetch(weatherUrl);
    const weatherData = await weatherRes.json();
    const c = weatherData.current;

    return JSON.stringify({
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      windGust: c.wind_gusts_10m,
      conditions: c.weather_code === 0 ? "Clear sky" : `Code ${c.weather_code}`,
      location: name,
    });
  },
  {
    name: "get_weather",
    description: "Get current weather for a location",
    schema: z.object({ location: z.string().describe("City name") }),
  },
);

const queryData = tool(
  async ({ query }) => {
    return JSON.stringify(csvData);
  },
  {
    name: "query_data",
    description:
      "Query the database, takes natural language. Always call before showing a chart or graph.",
    schema: z.object({ query: z.string().describe("Natural language query") }),
  },
);

const generateForm = tool(
  async () => {
    const components = [
      { id: "root", component: { Card: { child: "main-column" } } },
      {
        id: "main-column",
        component: {
          Column: {
            children: {
              explicitList: [
                "header",
                "name-field",
                "email-field",
                "event-type-field",
                "dietary-field",
                "register-btn",
              ],
            },
            gap: "medium",
          },
        },
      },
      {
        id: "header",
        component: {
          Column: {
            children: { explicitList: ["title", "subtitle"] },
            alignment: "center",
          },
        },
      },
      {
        id: "title",
        component: {
          Text: {
            text: { literalString: "Event Registration" },
            usageHint: "h2",
          },
        },
      },
      {
        id: "subtitle",
        component: {
          Text: {
            text: {
              literalString:
                "Register for the upcoming CopilotKit Developer Summit",
            },
            usageHint: "caption",
          },
        },
      },
      {
        id: "name-field",
        component: {
          TextField: {
            value: { path: "/name" },
            placeholder: { literalString: "Your full name" },
            label: { literalString: "Full Name" },
            action: "updateName",
          },
        },
      },
      {
        id: "email-field",
        component: {
          TextField: {
            value: { path: "/email" },
            placeholder: { literalString: "you@example.com" },
            label: { literalString: "Email" },
            action: "updateEmail",
          },
        },
      },
      {
        id: "event-type-field",
        component: {
          TextField: {
            value: { path: "/eventType" },
            placeholder: { literalString: "Workshop, Talk, or Both" },
            label: { literalString: "Session Type" },
            action: "updateEventType",
          },
        },
      },
      {
        id: "dietary-field",
        component: {
          TextField: {
            value: { path: "/dietary" },
            placeholder: { literalString: "Any dietary restrictions?" },
            label: { literalString: "Dietary Restrictions" },
            action: "updateDietary",
          },
        },
      },
      {
        id: "register-btn-text",
        component: { Text: { text: { literalString: "Register" } } },
      },
      {
        id: "register-btn",
        component: {
          Button: { child: "register-btn-text", action: "register" },
        },
      },
    ];
    return JSON.stringify([
      { surfaceUpdate: { surfaceId: "event-registration", components } },
      { beginRendering: { surfaceId: "event-registration", root: "root" } },
    ]);
  },
  {
    name: "generate_form",
    description:
      "Generates an event registration form for the user to sign up for an event.",
    schema: z.object({}),
  },
);

// manage_todos returns Command to update state — mirrors north star's Python implementation
const manageTodos = tool(
  ({ todos }, config) => {
    for (const todo of todos) {
      if (!todo.id) {
        todo.id = uuidv4();
      }
    }
    return new Command({
      update: {
        todos,
        messages: [
          new ToolMessage({
            content: "Successfully updated todos",
            tool_call_id: config.toolCall?.id ?? "unknown",
          }),
        ],
      },
    });
  },
  {
    name: "manage_todos",
    description:
      "Manage the current todos. Call this to add, update, or remove todos.",
    schema: z.object({
      todos: z.array(TodoSchema).describe("The complete list of todos"),
    }),
  },
);

const getTodos = tool(
  ({}, config) => {
    // State is injected into system prompt by middleware; this tool exists
    // so the LLM can explicitly request the current list.
    return "Check the current todos in the system message state.";
  },
  {
    name: "get_todos",
    description: "Get the current list of todos.",
    schema: z.object({}),
  },
);

// --- Agent (mirrors north star Python agent) ---

export const graph = createAgent({
  model: "openai:gpt-4.1",
  tools: [getWeather, queryData, generateForm, manageTodos, getTodos],
  middleware: [copilotkitMiddleware],
  stateSchema,
  systemPrompt: `You are a polished, professional demo assistant using CopilotKit and LangGraph. Only mention either when necessary.

Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

When demonstrating charts, always call the query_data tool to fetch data first.
When asked to manage todos, enable app mode first, then manage todos.`,
});
