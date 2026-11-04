import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import {
  BuiltInAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
  convertInputToTanStackAI,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
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

// The shop's TanStack AI agent. `convertInputToTanStackAI` adds the browser
// tools (navigateTo, addToCart), the page context, and the render_ui tool of
// generative UI to the server tools below.
const shopAssistant = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts, tools } = convertInputToTanStackAI(input);
    return chat({
      adapter: openaiText("gpt-5.5"),
      messages,
      systemPrompts: [SHOP_ASSISTANT_PROMPT, ...systemPrompts],
      tools: [
        ...tools,
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
      abortController,
    });
  },
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
