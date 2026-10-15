import {
  BuiltInAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import type { BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { handle } from "hono/vercel";
import { PRODUCTS } from "../../../generative-ui/products";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

const determineModel = (): BuiltInAgentClassicConfig["model"] => {
  if (openRouterApiKey) {
    const openrouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL:
        process.env.OPENROUTER_BASE_URL?.trim() ||
        "https://openrouter.ai/api/v1",
    });
    return openrouter(
      process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-5-mini",
    );
  }
  if (process.env.OPENAI_API_KEY?.trim()) return "openai/gpt-5.2";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic/claude-opus-4-8";
  if (process.env.GOOGLE_API_KEY?.trim()) return "google/gemini-3.8-flash";
  return "openai/gpt-5.2";
};

const agent = new BuiltInAgent({
  model: determineModel(),
  prompt: `You are the shopping assistant for Acme Audio.
Catalog (the only products that exist): ${JSON.stringify(PRODUCTS)}

Use the render_ui tool for UI:
- Product recommendations go to target "recommendations": a ProductGrid root plus one ProductCard per product. Send the root first with every card id already in its children, then each card in its own operation.
- Comparisons, cart summaries, and checkout go to target "chat".
- ProductCard props are exactly productId, name, price, tagline; set productId to the product's id; never add other props (no category).
- Bind ProductCard.onAddToCart to the addToCart function with the card's productId and quantity 1.
- Bind CartSummary to /app/cart/count and /app/cart/total instead of copying numbers.
- To refine recommendations later, update the existing surface instead of creating a new one.
Keep text replies short; let the UI carry the details.`,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
  generativeUI: {},
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit-generative-ui",
});

export const GET = handle(app);
export const POST = handle(app);
