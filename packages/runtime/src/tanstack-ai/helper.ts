import type { AnyTool } from "@tanstack/ai";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { AgentFactoryContext, ToolDefinition } from "../agent/index";
import { convertInputToTanStackAI } from "../agent/converters/tanstack";
import { assertNoSkillToolNameConflicts } from "../agent/learned-skills";
import { connectMCPServers } from "../agent/mcp";
import type { MCPClientConfig } from "../agent/mcp";
import {
  readInterruptDetails,
  stateToolSpecs,
  toolDefinitionToSpec,
  withInterruptDetails,
} from "../agent/tool-spec";
import type { AgentToolSpec } from "../agent/tool-spec";

/**
 * Server tools for a TanStack AI agent: TanStack AI tools (from
 * `toolDefinition()`, plain `Tool` objects, or provider tools) and
 * `defineTool` tools, in one array.
 */
export type TanStackAITools = ReadonlyArray<AnyTool | ToolDefinition>;

/** Options for {@link tanstackAI}. */
export interface TanStackAIOptions {
  /** The agent's system prompt. It comes after the learned-skills catalog. */
  prompt?: string;
  /**
   * Server tools. A tool with the same name as a frontend tool or a state
   * tool replaces it.
   */
  tools?: TanStackAITools;
  /**
   * MCP servers to connect to for this run. Their tools are added to the
   * run, and the clients close when the run ends. An MCP tool whose name is
   * already in use is renamed with the server's `name` (or `mcp<N>`) as a
   * prefix.
   */
  mcpServers?: MCPClientConfig[];
}

/**
 * Maps an SDK-neutral tool spec to a TanStack AI tool. An interrupt spec gets
 * `needsApproval: true` and carries its interrupt reason and message.
 */
function specToTanStackTool(spec: AgentToolSpec) {
  const tool: AnyTool = {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.parameters,
    execute: spec.execute,
  };
  if (!spec.interrupt) return tool;
  return withInterruptDetails(
    { ...tool, needsApproval: true },
    { reason: spec.interruptReason, message: spec.interruptMessage },
  );
}

/**
 * True when validation failed. Some libraries (Valibot) also set `value` on a
 * failure, so only `issues` tells the two apart.
 */
function isFailure(
  result: StandardSchemaV1.Result<unknown>,
): result is StandardSchemaV1.FailureResult {
  return result.issues !== undefined;
}

/**
 * Parses tool input with the tool's Standard Schema, so `execute` gets the
 * schema's output (defaults and transforms applied), not the raw model JSON.
 */
async function parseToolInput(
  schema: StandardSchemaV1,
  toolName: string,
  input: unknown,
) {
  const result = await schema["~standard"].validate(input);
  if (isFailure(result)) {
    const messages = result.issues.map((issue) => issue.message);
    throw new Error(
      `Invalid input for tool ${toolName}: ${messages.join("; ")}`,
    );
  }
  return result.value;
}

/**
 * Maps a `defineTool` tool to a TanStack AI tool. The parameters become JSON
 * Schema through `toolDefinitionToSpec`, and `execute` gets input parsed by
 * the tool's own schema. An interrupt tool gets `needsApproval: true`, so a
 * call to it pauses the run.
 */
function toolDefinitionToTanStackTool(definition: ToolDefinition) {
  const spec = toolDefinitionToSpec(definition);
  const { execute, parameters, name } = definition;
  return specToTanStackTool({
    ...spec,
    execute:
      execute &&
      (async (input) => execute(await parseToolInput(parameters, name, input))),
  });
}

function isToolDefinition(
  tool: AnyTool | ToolDefinition,
): tool is ToolDefinition {
  return "parameters" in tool;
}

/**
 * Maps `defineTool` tools to TanStack AI tools. TanStack AI tools pass
 * through unchanged.
 *
 * @throws Error when a `defineTool` schema cannot be converted to JSON
 *   Schema (for example a Valibot schema that is not wrapped in
 *   `toStandardJsonSchema`).
 */
export function toTanStackTools(tools: TanStackAITools) {
  return tools.map((tool) =>
    isToolDefinition(tool) ? toolDefinitionToTanStackTool(tool) : tool,
  );
}

/** Same name, later tool wins: a server tool can replace a frontend tool. */
function uniqueByName(tools: AnyTool[]) {
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) byName.set(tool.name, tool);
  return [...byName.values()];
}

/**
 * Builds the TanStack AI `chat()` options for one BuiltInAgent run, so a
 * factory that owns its `chat()` call still gets everything a CopilotKit
 * agent needs.
 *
 * - `messages`: the run's user, assistant, and tool messages.
 * - `systemPrompts`: the learned-skills catalog, then `prompt`, then the
 *   run's system and developer messages, context, and application state.
 * - `tools`: frontend tools, the two state tools, MCP tools, learned-skills
 *   tools, and `tools`.
 * - `abortController`, `threadId`, `runId`: from the run.
 *
 * MCP clients close when the run ends. Interrupt tools from `defineTool`
 * are described to the run, so their interrupts carry `interruptReason` and
 * `interruptMessage`.
 *
 * @param ctx - The factory context of the run.
 * @param options - The prompt, server tools, and MCP servers.
 * @throws Error when a tool uses a name reserved for learned skills.
 * @throws Error when a `defineTool` schema cannot be converted to JSON Schema.
 *
 * @example
 * ```ts
 * new BuiltInAgent({
 *   type: "tanstack",
 *   factory: async (ctx) => {
 *     const base = await tanstackAI(ctx, { prompt: "You are helpful." });
 *     return chat({ ...base, adapter: openaiText("gpt-5.5") });
 *   },
 * });
 * ```
 */
export async function tanstackAI(
  ctx: AgentFactoryContext,
  options: TanStackAIOptions = {},
) {
  const { input, learnedSkills, abortController, abortSignal } = ctx;
  const converted = convertInputToTanStackAI(input);

  const appTools = uniqueByName([
    ...converted.tools,
    ...stateToolSpecs.map(specToTanStackTool),
    ...toTanStackTools(options.tools ?? []),
  ]);
  const appToolNames = appTools.map((tool) => tool.name);

  const mcpServers = options.mcpServers ?? [];
  const mcp =
    mcpServers.length > 0
      ? await connectMCPServers(mcpServers, {
          signal: abortSignal,
          appToolNames,
        })
      : undefined;
  if (mcp) ctx.onRunEnd(mcp.close);
  const mcpTools = (mcp?.tools ?? []).map(specToTanStackTool);

  const skillTools = learnedSkills.definitions.map(specToTanStackTool);
  if (skillTools.length > 0) {
    assertNoSkillToolNameConflicts([
      ...appToolNames,
      ...mcpTools.map((tool) => tool.name),
    ]);
  }

  const systemPrompts = [
    learnedSkills.catalog,
    options.prompt ?? "",
    ...converted.systemPrompts,
  ].filter((prompt) => prompt.length > 0);

  const tools = [...appTools, ...mcpTools, ...skillTools];
  for (const tool of tools) {
    const details = readInterruptDetails(tool);
    if (details) ctx.describeInterruptTool(tool.name, details);
  }

  return {
    messages: converted.messages,
    systemPrompts,
    tools,
    abortController,
    threadId: converted.threadId,
    runId: converted.runId,
  };
}
