import type { BackendTool } from "@ag-ui/omnara";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toolRenderingHandlers } from "./tool-rendering";
import { weatherTool } from "./weather-tool";

function defineTool<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  handler: (input: z.output<T>) => unknown,
): BackendTool {
  return {
    name,
    description,
    parameters: zodToJsonSchema(schema, { $refStrategy: "none" }),
    handler: (input) => handler(schema.parse(input)),
  };
}

export const backendTools: BackendTool[] = [
  weatherTool,
  defineTool(
    "search_flights",
    "Search mock flights from an origin airport to a destination airport.",
    z.object({ origin: z.string(), destination: z.string() }),
    toolRenderingHandlers.search_flights,
  ),
  defineTool(
    "get_stock_price",
    "Get a mock current stock price. Optional price_usd and change_pct override the random quote for testing.",
    z.object({
      ticker: z.string(),
      price_usd: z.number().optional(),
      change_pct: z.number().optional(),
    }),
    toolRenderingHandlers.get_stock_price,
  ),
  defineTool(
    "roll_d20",
    "Roll a 20-sided die. Optional value sets a deterministic result for testing.",
    z.object({ value: z.number().int().optional() }),
    toolRenderingHandlers.roll_d20,
  ),
];
