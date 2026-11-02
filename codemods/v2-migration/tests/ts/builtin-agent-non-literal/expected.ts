import { BuiltInAgent } from "@copilotkit/runtime";
import { openai } from "@ai-sdk/openai";

const MODEL = "openai/gpt-5.5";
const model = MODEL;

// TODO(copilotkit-2.0): Classic `BuiltInAgent` mode (`model`) was removed in 2.0, and the codemod can't map this model to a TanStack AI adapter. Use `tanstackAIAgent({ adapter })` from "@copilotkit/runtime/tanstack-ai", or `aiSdkAgent({ model })` from "@copilotkit/runtime/ai-sdk" with an AI SDK provider (for example `@ai-sdk/google-vertex`). See https://docs.copilotkit.ai/migrate/runtime-2.0
export const fromConstant = new BuiltInAgent({ model: MODEL });
// TODO(copilotkit-2.0): Classic `BuiltInAgent` mode (`model`) was removed in 2.0, and the codemod can't map this model to a TanStack AI adapter. Use `tanstackAIAgent({ adapter })` from "@copilotkit/runtime/tanstack-ai", or `aiSdkAgent({ model })` from "@copilotkit/runtime/ai-sdk" with an AI SDK provider (for example `@ai-sdk/google-vertex`). See https://docs.copilotkit.ai/migrate/runtime-2.0
export const fromShorthand = new BuiltInAgent({ model });
// TODO(copilotkit-2.0): Classic `BuiltInAgent` mode (`model`) was removed in 2.0, and the codemod can't map this model to a TanStack AI adapter. Use `tanstackAIAgent({ adapter })` from "@copilotkit/runtime/tanstack-ai", or `aiSdkAgent({ model })` from "@copilotkit/runtime/ai-sdk" with an AI SDK provider (for example `@ai-sdk/google-vertex`). See https://docs.copilotkit.ai/migrate/runtime-2.0
export const fromLanguageModel = new BuiltInAgent({ model: openai("gpt-5.5") });
