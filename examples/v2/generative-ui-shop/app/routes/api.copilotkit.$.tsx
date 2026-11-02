import { openaiText } from "@tanstack/ai-openai";
import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { SHOP_ASSISTANT_PROMPT } from "#app/prompts/system.ts";
import { getCareInstructions } from "#app/tools/care-instructions.ts";
import {
  findSimilarProducts,
  getProductsTool,
  recommendProducts,
  searchProducts,
} from "#app/tools/products.ts";
import { subscribeToRestock } from "#app/tools/restock.ts";
import { getReturnPolicy } from "#app/tools/return-policy.ts";
import { getShippingEstimate } from "#app/tools/shipping.ts";
import { getSizeGuide } from "#app/tools/size-guide.ts";
import { showVariations } from "#app/tools/variations.ts";
import type { Route } from "./+types/api.copilotkit.$";

// The shop's TanStack AI agent. Each run also gets the browser tools
// (navigateTo, addToCart), the page context, and the render_ui tool of
// generative UI, next to the server tools below.
const shopAssistant = tanstackAIAgent({
  adapter: openaiText("gpt-5.5"),
  prompt: SHOP_ASSISTANT_PROMPT,
  tools: [
    // Eager tools: described to the model on every message.
    searchProducts,
    findSimilarProducts,
    recommendProducts,
    getProductsTool,
    showVariations,
    // Lazy tools: the model sees only their names until it asks for one.
    getReturnPolicy,
    getSizeGuide,
    getCareInstructions,
    subscribeToRestock,
    getShippingEstimate,
  ],
});

// generativeUI: true gives every run the render_ui tool, so the agent can
// render surfaces into the page areas that are on screen.
const runtime = new CopilotRuntime({
  agents: { default: shopAssistant },
  runner: new InMemoryAgentRunner(),
  generativeUI: true,
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const loader = ({ request }: Route.LoaderArgs) => handler(request);
export const action = ({ request }: Route.ActionArgs) => handler(request);
