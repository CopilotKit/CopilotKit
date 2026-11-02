import { jsonSchema, tool } from "ai";
import type {
  Experimental_DownloadFunction as DownloadFunction,
  SystemModelMessage,
  ToolSet,
} from "ai";
import type { AgentFactoryContext, ToolDefinition } from "../agent";
import { assertNoSkillToolNameConflicts } from "../agent/learned-skills";
import { connectMCPServers } from "../agent/mcp";
import type { MCPClientConfig } from "../agent/mcp";
import { buildAgentSystemPrompt } from "../agent/prompt";
import {
  readInterruptDetails,
  stateToolSpecs,
  withInterruptDetails,
} from "../agent/tool-spec";
import type { AgentToolSpec } from "../agent/tool-spec";
import { convertMessagesToVercelAISDKMessages } from "./messages";
import {
  convertToolDefinitionsToVercelAITools,
  convertToolsToVercelAITools,
} from "./tools";
import { resolveUrlDownloadSetting } from "./url-download";
import type { SafeUrlDownloadOptions } from "./url-download";

/** Server tools as an AI SDK `ToolSet`, or as `defineTool` results. */
export type AiSdkTools = ToolSet | ToolDefinition[];

/**
 * How the server downloads URL attachments that the model cannot take as a
 * URL. The URL comes from the request, so the server must not fetch it
 * blindly.
 *
 * - `"safe"` (default) or an options object: download only from public
 *   internet addresses, with size, time, and redirect limits. Use
 *   `allowedHosts` to limit downloads to hosts you list.
 * - `false`: never download. An attachment URL that the model cannot take
 *   directly, other than `data:`, fails the run.
 * - A function: your own AI SDK download function. You own what it fetches.
 */
export type AiSdkUrlDownload =
  | "safe"
  | false
  | SafeUrlDownloadOptions
  | DownloadFunction;

/** Options for {@link aiSdk}. */
export interface AiSdkOptions {
  /** The agent's system prompt. Run context and state are added after it. */
  prompt?: string;
  /**
   * Your server tools. They come last, so they win a name clash with a
   * frontend or state tool. `defineTool` results with `interrupt: true`
   * pause the run when the model calls them.
   */
  tools?: AiSdkTools;
  /**
   * MCP servers to connect to for this run. Their tools are added, and a
   * tool name that clashes with another tool gets a prefix. The clients close
   * when the run ends.
   */
  mcpServers?: MCPClientConfig[];
  /** Send system-role messages from the client to the model. Default: false. */
  forwardSystemMessages?: boolean;
  /** Send developer-role messages from the client to the model as system messages. Default: false. */
  forwardDeveloperMessages?: boolean;
  /** How the server downloads URL attachments. Default: `"safe"`. */
  urlDownload?: AiSdkUrlDownload;
}

/**
 * Maps SDK-neutral tool specs to AI SDK tools. An interrupt spec gets
 * `needsApproval: true`, so a call to it pauses the run, and is marked with
 * its interrupt reason and message.
 */
export function toolSpecsToToolSet(specs: readonly AgentToolSpec[]) {
  const tools: ToolSet = {};
  for (const spec of specs) {
    const aiTool = tool({
      description: spec.description,
      inputSchema: jsonSchema<Record<string, unknown>>(spec.parameters),
      execute: spec.execute,
      needsApproval: spec.interrupt === true,
    });
    tools[spec.name] = spec.interrupt
      ? withInterruptDetails(aiTool, {
          reason: spec.interruptReason,
          message: spec.interruptMessage,
        })
      : aiTool;
  }
  return tools;
}

/**
 * Maps `defineTool` results to AI SDK tools. The converter keeps Zod schemas
 * native; this adds `needsApproval` and the interrupt reason and message to
 * the interrupt tools.
 */
function toolDefinitionsToToolSet(definitions: ToolDefinition[]) {
  const tools = convertToolDefinitionsToVercelAITools(definitions);
  for (const definition of definitions) {
    if (definition.interrupt) {
      tools[definition.name] = withInterruptDetails(
        { ...tools[definition.name], needsApproval: true },
        {
          reason: definition.interruptReason,
          message: definition.interruptMessage,
        },
      );
    }
  }
  return tools;
}

function toToolSet(tools: AiSdkTools) {
  return Array.isArray(tools) ? toolDefinitionsToToolSet(tools) : tools;
}

/**
 * Resolves a {@link AiSdkUrlDownload} setting once, so that invalid options
 * throw right away. The result gives the download function for one run,
 * stopped when that run's signal aborts.
 */
export function resolveAiSdkUrlDownload(setting: AiSdkUrlDownload = "safe") {
  if (setting === false) return resolveUrlDownloadSetting("disabled");
  if (setting === "safe") return resolveUrlDownloadSetting(undefined);
  return resolveUrlDownloadSetting(setting);
}

async function connectMCPTools(
  ctx: Pick<AgentFactoryContext, "abortSignal" | "onRunEnd">,
  servers: MCPClientConfig[],
  appToolNames: string[],
) {
  if (servers.length === 0) return {};
  const mcp = await connectMCPServers(servers, {
    signal: ctx.abortSignal,
    appToolNames,
  });
  ctx.onRunEnd(mcp.close);
  return toolSpecsToToolSet(mcp.tools);
}

/**
 * Builds the `streamText()` arguments for one BuiltInAgent run: the
 * conversation, the system prompt, every tool the run should have, the safe
 * URL downloader, and the run's abort signal. Spread the result into
 * `streamText()` and add your model.
 *
 * - `system`: the learned-skills catalog, then `prompt` with the run's
 *   context and state. When the conversation is empty, these system messages
 *   go in `messages` instead, because the AI SDK rejects empty `messages`.
 * - `tools`: frontend tools, the AG-UI state tools, MCP tools, learned-skills
 *   tools, then `options.tools`.
 * - `allowSystemInMessages`: true when `messages` holds a system message. AI
 *   SDK v7 rejects those without it. AI SDK v6 ignores it.
 *
 * MCP clients close when the run ends. Interrupt tools, including tools
 * you marked with `withInterruptDetails`, report their reason and message
 * on the interrupt.
 *
 * @param ctx - The factory context that BuiltInAgent passes to `factory`.
 * @param options - The prompt, your tools, MCP servers, message forwarding,
 *   and the URL download setting.
 * @throws Error when a tool uses a name reserved for learned skills.
 * @throws Error when a frontend tool has an invalid JSON Schema, or when
 *   `urlDownload` has invalid options.
 *
 * @example
 * ```ts
 * new BuiltInAgent({
 *   type: "aisdk",
 *   factory: async (ctx) => {
 *     const base = await aiSdk(ctx, { prompt: "You are helpful." });
 *     return streamText({ ...base, model: openai("gpt-5.5") });
 *   },
 * });
 * ```
 */
export async function aiSdk(
  ctx: Pick<
    AgentFactoryContext,
    | "input"
    | "abortSignal"
    | "learnedSkills"
    | "onRunEnd"
    | "describeInterruptTool"
  >,
  options: AiSdkOptions = {},
) {
  const { input, abortSignal, learnedSkills } = ctx;
  const downloadForRun = resolveAiSdkUrlDownload(options.urlDownload);

  const conversation = convertMessagesToVercelAISDKMessages(input.messages, {
    forwardSystemMessages: options.forwardSystemMessages,
    forwardDeveloperMessages: options.forwardDeveloperMessages,
  });
  const systemTexts = [
    learnedSkills.catalog,
    buildAgentSystemPrompt(input, { prompt: options.prompt }),
  ];
  const systemMessages = systemTexts
    .filter((content) => !!content)
    .map((content): SystemModelMessage => ({ role: "system", content }));
  const hasConversation = conversation.length > 0;
  const messages = hasConversation ? conversation : systemMessages;
  const system =
    hasConversation && systemMessages.length > 0 ? systemMessages : undefined;

  const frontendTools = convertToolsToVercelAITools(input.tools);
  const stateTools = toolSpecsToToolSet(stateToolSpecs);
  const userTools = toToolSet(options.tools ?? {});
  const mcpTools = await connectMCPTools(ctx, options.mcpServers ?? [], [
    ...Object.keys(frontendTools),
    ...Object.keys(stateTools),
    ...Object.keys(userTools),
  ]);
  assertNoSkillToolNameConflicts([
    ...Object.keys(frontendTools),
    ...Object.keys(stateTools),
    ...Object.keys(mcpTools),
    ...Object.keys(userTools),
  ]);
  const skillTools = toolSpecsToToolSet(learnedSkills.definitions);
  const tools: ToolSet = {
    ...frontendTools,
    ...stateTools,
    ...mcpTools,
    ...skillTools,
    ...userTools,
  };
  const toolEntries = Object.entries(tools);
  for (const [name, aiTool] of toolEntries) {
    const details = readInterruptDetails(aiTool);
    if (details) ctx.describeInterruptTool(name, details);
  }

  return {
    system,
    messages,
    allowSystemInMessages: messages.some(
      (message) => message.role === "system",
    ),
    tools,
    experimental_download: downloadForRun(abortSignal),
    abortSignal,
  };
}
