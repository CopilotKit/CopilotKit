// ---------------------------------------------------------------------------
// tkt-builtin-aisdk-v6: BuiltInAgent incompatible with AI SDK v6 providers
//
// Issue: CopilotKit's BuiltInAgentConfiguration expects LanguageModel from
// ai@^5 (LanguageModelV2, specificationVersion: "v2"). AI SDK v6 providers
// (e.g. @ai-sdk/openai@^3) return LanguageModelV3 (specificationVersion: "v3").
//
// Passing an AI SDK v6 model to new BuiltInAgent({ model }) causes a
// TypeScript error:
//
//   Type 'LanguageModelV3' is not assignable to type 'LanguageModelV2'.
//   Types of property 'specificationVersion' are incompatible.
//   Type '"v3"' is not assignable to type '"v2"'.
//
// Sandbox: https://github.com/mubinansari/copilotkit-1.50-integration/tree/11-copilot-built-in-agent-with-ai-sdk-v6
// Slack:   https://copilotkit.slack.com/archives/C070G2NGHDX/p1772032203248049
// ---------------------------------------------------------------------------

import { BuiltInAgent } from "@copilotkitnext/agent";
import {
  CopilotRuntime,
  createCopilotEndpointSingleRoute,
} from "@copilotkitnext/runtime";

import { createOpenAI } from "@ai-sdk/openai";

// ---------------------------------------------------------------------------
// AI SDK v6 provider — @ai-sdk/openai@^3.x
//
// createOpenAI() returns a provider whose model instances have
// specificationVersion: "v3" (LanguageModelV3).
// ---------------------------------------------------------------------------

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "sk-placeholder",
});

const model = openai("gpt-4o-mini");

console.log("[tkt-builtin-aisdk-v6 server] Model created:", {
  modelId: model.modelId,
  provider: model.provider,
  specificationVersion: model.specificationVersion,
});

// ---------------------------------------------------------------------------
// THE TYPE ERROR:
//
// BuiltInAgent expects: LanguageModel (from ai@^5 = LanguageModelV2)
// We're passing:        LanguageModelV3 (from @ai-sdk/openai@^3 / ai@6)
//
// TypeScript will report:
//   Argument of type '{ model: LanguageModelV3; ... }' is not assignable to
//   parameter of type 'BuiltInAgentConfiguration'.
//   Types of property 'model' are incompatible.
//   Type 'LanguageModelV3' is not assignable to type 'BuiltInAgentModel | LanguageModel'.
//
// Uncommenting the @ts-expect-error below suppresses the error so the
// reproduction can run at runtime (the models are wire-compatible, only the
// type guard differs).
// ---------------------------------------------------------------------------

// @ts-expect-error LanguageModelV3 is not assignable to LanguageModelV2 — this IS the bug
const agent = new BuiltInAgent({
  model: model,
  prompt: "You are a helpful assistant for testing the BuiltInAgent + AI SDK v6 type compatibility.",
  maxSteps: 3,
});

console.log("[tkt-builtin-aisdk-v6 server] BuiltInAgent created (with @ts-expect-error)");

const runtime = new CopilotRuntime({
  agents: { default: agent },
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/",
});

console.log("[tkt-builtin-aisdk-v6 server] Endpoint ready at /api/tickets/tkt-builtin-aisdk-v6/copilot");

export const handler = (request: Request) => {
  const url = new URL(request.url);
  console.log("[tkt-builtin-aisdk-v6 server] Incoming:", request.method, url.pathname);
  url.pathname = "/";
  return app.fetch(new Request(url, request));
};
