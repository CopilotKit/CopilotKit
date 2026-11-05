import { openaiText } from "@tanstack/ai-openai";
import { streamText } from "ai";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import type { MCPClient, MCPTransport } from "@copilotkit/runtime/agent";
import {
  createSafeUrlDownload,
  toAISDKTools,
} from "@copilotkit/runtime/agent/ai-sdk";
// @ts-expect-error The root entry no longer exports the Built-in Agent.
import { BuiltInAgent as RootBuiltInAgent } from "@copilotkit/runtime";

/** A model string resolves to a TanStack AI adapter at run time. */
export const fromModelString = new BuiltInAgent({ model: "openai/gpt-5" });

/** A TanStack AI text adapter is accepted as the model. */
export const fromAdapter = new BuiltInAgent({ model: openaiText("gpt-5") });

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

/** The MCP types come from `@tanstack/ai-mcp` through the agent entry. */
export async function closeClient(client: MCPClient, transport: MCPTransport) {
  await client.close();
  await transport.close();
}

export { RootBuiltInAgent };
