import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { PRODUCTS } from "../../../generative-ui/products";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

const determineModel = () => {
  if (openRouterApiKey) {
    return openaiCompatibleText(
      process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-5-mini",
      {
        name: "openrouter",
        api: "chat-completions",
        apiKey: openRouterApiKey,
        baseURL:
          process.env.OPENROUTER_BASE_URL?.trim() ||
          "https://openrouter.ai/api/v1",
      },
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
- Show product recommendations as a ProductGrid root plus one ProductCard per product. Send the root first with every card id already in its children, then each card in its own operation.
- ProductCard props are exactly productId, name, price, tagline; set productId to the product's id; never add other props (no category).
- To refine recommendations later, update the existing surface instead of creating a new one.
Keep text replies short; let the UI carry the details.`,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
  generativeUI: true,
});

const app = createCopilotRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit-generative-ui",
});

export const GET = app;
export const POST = app;
