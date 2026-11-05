import { openaiText } from "@tanstack/ai-openai";
import { streamText } from "ai";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import {
  createSafeUrlDownload,
  toAISDKTools,
} from "@copilotkit/runtime/agent/ai-sdk";
// @ts-expect-error The root entry no longer exports the Built-in Agent.
import { BuiltInAgent as RootBuiltInAgent } from "@copilotkit/runtime";

/** A TanStack AI text adapter is the model. */
export const fromAdapter = new BuiltInAgent({ model: openaiText("gpt-5") });

/** A model string is not a model. */
// @ts-expect-error model must be a TanStack AI text adapter
export const fromModelString = new BuiltInAgent({ model: "openai/gpt-5" });

/** `resolveModel` gets the forwarded name as a string and may decline it. */
export const withResolver = new BuiltInAgent({
  model: openaiText("gpt-5"),
  overridableProperties: ["model"],
  resolveModel: (name) =>
    name.startsWith("fast") ? openaiText("gpt-5-mini") : undefined,
});

export const withBadResolver = new BuiltInAgent({
  model: openaiText("gpt-5"),
  // @ts-expect-error resolveModel returns an adapter, not a model string
  resolveModel: (name) => `openai/${name}`,
});

export const withMcpServers = new BuiltInAgent({
  model: openaiText("gpt-5"),
  // @ts-expect-error mcpServers is not an option: pass clients in mcpClients
  mcpServers: [{ type: "http", url: "https://mcp.example.com/mcp" }],
});

/** An AI SDK factory gets the learned-skills tools and the URL guard. */
export const fromAISDKFactory = new BuiltInAgent({
  type: "aisdk",
  factory: (ctx) =>
    streamText({
      model: "openai/gpt-5",
      prompt: "Say hello.",
      tools: toAISDKTools(ctx.learnedSkills.tools),
      abortSignal: ctx.abortSignal,
      experimental_download: createSafeUrlDownload({
        signal: ctx.abortSignal,
      }),
    }),
});

export { RootBuiltInAgent };
