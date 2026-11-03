import { BuiltInAgent } from "@copilotkit/runtime";

// TODO(copilotkit-2.0): Classic `BuiltInAgent` mode (`model`) was removed in 2.0, and the codemod can't map this model to a TanStack AI adapter. Use `tanstackAIAgent({ adapter })` from "@copilotkit/runtime/tanstack-ai", or `aiSdkAgent({ model })` from "@copilotkit/runtime/ai-sdk" with an AI SDK provider (for example `@ai-sdk/google-vertex`). See https://docs.copilotkit.ai/migrate/runtime-2.0
export const vertex = new BuiltInAgent({ model: "vertex/gemini-2.5-pro", temperature: 0.2 });
export const agents = {
  // TODO(copilotkit-2.0): Classic `BuiltInAgent` mode (`model`) was removed in 2.0, and the codemod can't map this model to a TanStack AI adapter. Use `tanstackAIAgent({ adapter })` from "@copilotkit/runtime/tanstack-ai", or `aiSdkAgent({ model })` from "@copilotkit/runtime/ai-sdk" with an AI SDK provider (for example `@ai-sdk/google-vertex`). See https://docs.copilotkit.ai/migrate/runtime-2.0
  minimax: new BuiltInAgent({ model: "minimax/MiniMax-M2" }),
};
