// Server-side demo tools for the CopilotKit showcase `openclaw` integration.
//
// These are REAL OpenClaw backend tools: they execute server-side inside the
// agent loop and the model both SEES their schemas and DISPATCHES them. This
// plugin is vendored in the showcase integration ONLY — it makes NO edits to
// OpenClaw core and is separate from the clawg-ui adapter (which stays a
// general-purpose channel plugin, free of demo-specific tools).
//
// Mechanism: a dedicated tool plugin whose tool names are declared in
// `openclaw.plugin.json` `contracts.tools`. OpenClaw's plugin loader
// materializes them for every agent run (reply + embedded paths); the tools
// clear the active tool-profile allowlist because `gateway/setup.sh` adds their
// names to `tools.alsoAllow` (additive to the `coding` profile). This mirrors
// how the langgraph-python reference backs the same demos with backend `@tool`s
// (and how mme's Hermes integration uses its own registry in `showcase_tools.py`).
//
// Return values are deterministic (stable screenshots/e2e) and use the exact
// shapes the demo render functions expect — the shapes match langgraph-python
// 1:1 so the shared demo cards render unchanged. `execute` returns a plain
// object/array; OpenClaw serializes it to the tool result the client renders.

import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { financialLedger } from "./data.js";

// ---------------------------------------------------------------------------
// Deterministic data builders (shapes verbatim from langgraph-python; identical
// to mme's hermes showcase_tools.py so demo cards are cross-integration stable).
// ---------------------------------------------------------------------------

const weatherData = (location) => ({
  city: location,
  temperature: 68,
  humidity: 55,
  wind_speed: 10,
  conditions: "Sunny",
});

const flightsData = (origin, destination) => ({
  origin,
  destination,
  flights: [
    { airline: "United", flight: "UA231", depart: "08:15", arrive: "16:45", price_usd: 348 },
    { airline: "Delta", flight: "DL412", depart: "11:20", arrive: "19:55", price_usd: 312 },
    { airline: "JetBlue", flight: "B6722", depart: "17:05", arrive: "01:30", price_usd: 289 },
  ],
});

// Optional price_usd/change_pct let a caller (or aimock fixture) script exact
// values; absent, fall back to the deterministic defaults (not random) so demo
// output is stable.
const stockData = (ticker, priceUsd, changePct) => ({
  ticker: String(ticker || "").toUpperCase(),
  price_usd: typeof priceUsd === "number" ? priceUsd : 189.42,
  change_pct: typeof changePct === "number" ? changePct : 1.27,
});

// Echo a scripted value when it is a valid d20 face (1–20); else deterministic 11.
const d20Data = (value) => {
  const v = Number.isInteger(value) && value >= 1 && value <= 20 ? value : 11;
  return { sides: 20, value: v, result: v };
};

const revenueChartData = () => ({
  title: "Quarterly revenue",
  subtitle: "Last six months · USD thousands",
  data: [
    { label: "Jan", value: 38 },
    { label: "Feb", value: 47 },
    { label: "Mar", value: 52 },
    { label: "Apr", value: 49 },
    { label: "May", value: 63 },
    { label: "Jun", value: 71 },
  ],
});

export default defineToolPlugin({
  id: "showcase-tools",
  name: "Showcase Demo Tools",
  description:
    "Deterministic backend tools that back the CopilotKit showcase demos " +
    "(weather / flights / stock / dice / revenue chart / financial data).",
  tools: (tool) => [
    tool({
      name: "get_weather",
      description: "Get the current weather for a location.",
      parameters: {
        type: "object",
        properties: { location: { type: "string", description: "City or place name." } },
        required: ["location"],
        additionalProperties: false,
      },
      execute: async (params) => weatherData(params.location),
    }),
    tool({
      name: "search_flights",
      description: "Search available flights between two cities.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Origin city or airport." },
          destination: { type: "string", description: "Destination city or airport." },
        },
        required: ["origin", "destination"],
        additionalProperties: false,
      },
      execute: async (params) => flightsData(params.origin, params.destination),
    }),
    tool({
      name: "get_stock_price",
      description: "Get the current stock price for a ticker symbol.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Stock ticker symbol." },
          price_usd: { type: "number", description: "Optional scripted price." },
          change_pct: { type: "number", description: "Optional scripted daily change percent." },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      execute: async (params) => stockData(params.ticker, params.price_usd, params.change_pct),
    }),
    tool({
      name: "roll_d20",
      description: "Roll a 20-sided die.",
      parameters: {
        type: "object",
        properties: { value: { type: "integer", description: "Optional scripted face (1-20)." } },
        additionalProperties: false,
      },
      execute: async (params) => d20Data(params.value),
    }),
    tool({
      name: "get_revenue_chart",
      description: "Get the last six months of revenue as chart data.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => revenueChartData(),
    }),
    tool({
      name: "query_data",
      description:
        "Query the financial database, takes natural language. Always call " +
        "before showing a chart or graph.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language description of the data." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      // Returns the full ledger (like langgraph's query_data); the model
      // aggregates the rows into the pie/bar chart it renders.
      execute: async () => financialLedger,
    }),
  ],
});
