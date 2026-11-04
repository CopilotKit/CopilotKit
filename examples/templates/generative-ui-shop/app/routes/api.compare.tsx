import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { getProductById } from "#app/domain/products.server.ts";
import {
  COMPARISON_SYSTEM_PROMPT,
  buildComparisonPrompt,
} from "#app/prompts/comparison.ts";
import { CompareForwardedProps } from "#app/schemas/chat.js";
import { ComparisonSchema } from "#app/schemas/comparison.ts";
import { findSimilarProducts, searchProducts } from "#app/tools/products.ts";
import type { Route } from "./+types/api.compare";

const adapter = openaiText(
  (process.env.OPENAI_MODEL ?? "gpt-5.5") as "gpt-5.5",
);

export const action = async ({ request }: Route.ActionArgs) => {
  const { messages, forwardedProps } = await chatParamsFromRequest(request);
  const props = CompareForwardedProps.safeParse(forwardedProps);
  if (!props.success) {
    return new Response(props.error.message, { status: 400 });
  }

  const products = (
    await Promise.all(props.data.productIds.map((id) => getProductById(id)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  if (products.length === 0) {
    return new Response("No valid products to compare.", { status: 400 });
  }

  const systemPrompts = [
    COMPARISON_SYSTEM_PROMPT,
    buildComparisonPrompt(products),
  ];

  const stream = chat({
    adapter,
    systemPrompts,
    messages,
    tools: [searchProducts, findSimilarProducts],
    outputSchema: ComparisonSchema,
    stream: true,
  });
  return toServerSentEventsResponse(stream);
};
