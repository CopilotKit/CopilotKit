import { createChatOptions } from "@tanstack/ai";
import type { MCPToolSource } from "@tanstack/ai";
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

/** `resolveModel` may return `createChatOptions()`, typed by its adapter. */
export const withChatOptionsResolver = new BuiltInAgent({
  model: openaiText("gpt-5"),
  overridableProperties: ["model"],
  resolveModel: (name) =>
    name === "deep"
      ? createChatOptions({
          adapter: openaiText("gpt-5.2"),
          reasoning: "high",
          modelOptions: { text: { verbosity: "low" } },
        })
      : undefined,
});

/** `modelOptions` and `reasoning` are typed by the adapter in `model`. */
export const withChatOptions = new BuiltInAgent({
  model: openaiText("gpt-5.2"),
  modelOptions: { text: { verbosity: "low" } },
  reasoning: { level: "high", summary: true },
  retry: { maxRetries: 3 },
});

export const withBadModelOptions = new BuiltInAgent({
  model: openaiText("gpt-5.2"),
  // @ts-expect-error topK is not an OpenAI provider option
  modelOptions: { topK: 40 },
});

export const withBadReasoning = new BuiltInAgent({
  model: openaiText("gpt-5.2"),
  // @ts-expect-error gpt-5.2 has no "minimal" reasoning level
  reasoning: "minimal",
});

export const withThreadId = new BuiltInAgent({
  model: openaiText("gpt-5"),
  // @ts-expect-error the agent sets the thread id of each run
  threadId: "t",
});

/** MCP clients go in chat()'s `mcp` option. */
const mcpClient: MCPToolSource = {
  tools: async () => [],
  close: async () => {},
};

export const withMcp = new BuiltInAgent({
  model: openaiText("gpt-5"),
  mcp: { clients: [mcpClient], onDiscoveryError: () => {} },
});

export const withMcpServers = new BuiltInAgent({
  model: openaiText("gpt-5"),
  // @ts-expect-error mcpServers is not an option: pass clients in mcp.clients
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
