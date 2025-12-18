import { AbstractAgent, AgentSubscriber, HttpAgent, Message, RunAgentResult, Tool } from "@ag-ui/client";
import { randomUUID, logger } from "@copilotkitnext/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CopilotKitCore } from "./core";
import { CopilotKitCoreErrorCode, CopilotKitCoreFriendsAccess } from "./core";
import { FrontendTool } from "../types";

export interface CopilotKitCoreRunAgentParams {
  agent: AbstractAgent;
}

export interface CopilotKitCoreConnectAgentParams {
  agent: AbstractAgent;
}

export interface CopilotKitCoreGetToolParams {
  toolName: string;
  agentId?: string;
}

/**
 * Handles agent execution, tool calling, and agent connectivity for CopilotKitCore.
 * Manages the complete lifecycle of agent runs including tool execution and follow-ups.
 */
export class RunHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _tools: FrontendTool<any>[] = [];

  constructor(private core: CopilotKitCore) {}

  /**
   * Get all tools as a readonly array
   */
  get tools(): Readonly<FrontendTool<any>[]> {
    return this._tools;
  }

  /**
   * Initialize with tools
   */
  initialize(tools: FrontendTool<any>[]): void {
    this._tools = tools;
  }

  /**
   * Add a tool to the registry
   */
  addTool<T extends Record<string, unknown> = Record<string, unknown>>(tool: FrontendTool<T>): void {
    // Check if a tool with the same name and agentId already exists
    const existingToolIndex = this._tools.findIndex((t) => t.name === tool.name && t.agentId === tool.agentId);

    if (existingToolIndex !== -1) {
      logger.warn(`Tool already exists: '${tool.name}' for agent '${tool.agentId || "global"}', skipping.`);
      return;
    }

    this._tools.push(tool);
  }

  /**
   * Remove a tool by name and optionally by agentId
   */
  removeTool(id: string, agentId?: string): void {
    this._tools = this._tools.filter((tool) => {
      // Remove tool if both name and agentId match
      if (agentId !== undefined) {
        return !(tool.name === id && tool.agentId === agentId);
      }
      // If no agentId specified, only remove global tools with matching name
      return !(tool.name === id && !tool.agentId);
    });
  }

  /**
   * Get a tool by name and optionally by agentId.
   * If agentId is provided, it will first look for an agent-specific tool,
   * then fall back to a global tool with the same name.
   */
  getTool(params: CopilotKitCoreGetToolParams): FrontendTool<any> | undefined {
    const { toolName, agentId } = params;

    // If agentId is provided, first look for agent-specific tool
    if (agentId) {
      const agentTool = this._tools.find((tool) => tool.name === toolName && tool.agentId === agentId);
      if (agentTool) {
        return agentTool;
      }
    }

    // Fall back to global tool (no agentId)
    return this._tools.find((tool) => tool.name === toolName && !tool.agentId);
  }

  /**
   * Set all tools at once. Replaces existing tools.
   */
  setTools(tools: FrontendTool<any>[]): void {
    this._tools = [...tools];
  }

  /**
   * Connect an agent (establish initial connection)
   */
  async connectAgent({ agent }: CopilotKitCoreConnectAgentParams): Promise<RunAgentResult> {
    try {
      // Detach any active run before connecting to avoid previous runs interfering
      await agent.detachActiveRun();
      agent.setMessages([]);
      agent.setState({});

      if (agent instanceof HttpAgent) {
        agent.headers = { ...(this.core as unknown as CopilotKitCoreFriendsAccess).headers };
      }

      const runAgentResult = await agent.connectAgent(
        {
          forwardedProps: (this.core as unknown as CopilotKitCoreFriendsAccess).properties,
          tools: this.buildFrontendTools(agent.agentId),
        },
        this.createAgentErrorSubscriber(agent),
      );

      return this.processAgentResult({ runAgentResult, agent });
    } catch (error) {
      const connectError = error instanceof Error ? error : new Error(String(error));
      const context: Record<string, any> = {};
      if (agent.agentId) {
        context.agentId = agent.agentId;
      }
      await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
        error: connectError,
        code: CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED,
        context,
      });
      throw error;
    }
  }

  /**
   * Run an agent
   */
  async runAgent({ agent }: CopilotKitCoreRunAgentParams): Promise<RunAgentResult> {
    // Agent ID is guaranteed to be set by validateAndAssignAgentId
    if (agent.agentId) {
      void (this.core as unknown as CopilotKitCoreFriendsAccess).suggestionEngine.clearSuggestions(agent.agentId);
    }

    if (agent instanceof HttpAgent) {
      agent.headers = { ...(this.core as unknown as CopilotKitCoreFriendsAccess).headers };
    }

    try {
      const runAgentResult = await agent.runAgent(
        {
          forwardedProps: (this.core as unknown as CopilotKitCoreFriendsAccess).properties,
          tools: this.buildFrontendTools(agent.agentId),
          context: Object.values((this.core as unknown as CopilotKitCoreFriendsAccess).context),
        },
        this.createAgentErrorSubscriber(agent),
      );
      return this.processAgentResult({ runAgentResult, agent });
    } catch (error) {
      const runError = error instanceof Error ? error : new Error(String(error));
      const context: Record<string, any> = {};
      if (agent.agentId) {
        context.agentId = agent.agentId;
      }
      await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
        error: runError,
        code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
        context,
      });
      throw error;
    }
  }

  /**
   * Process agent result and execute tools
   */
  private async processAgentResult({
    runAgentResult,
    agent,
  }: {
    runAgentResult: RunAgentResult;
    agent: AbstractAgent;
  }): Promise<RunAgentResult> {
    const { newMessages } = runAgentResult;
    // Agent ID is guaranteed to be set by validateAndAssignAgentId
    const agentId = agent.agentId!;

    let needsFollowUp = false;

    for (const message of newMessages) {
      if (message.role === "assistant") {
        for (const toolCall of message.toolCalls || []) {
          if (newMessages.findIndex((m) => m.role === "tool" && m.toolCallId === toolCall.id) === -1) {
            const tool = this.getTool({
              toolName: toolCall.function.name,
              agentId: agent.agentId,
            });
            if (tool) {
              const followUp = await this.executeSpecificTool(tool, toolCall, message, agent, agentId);
              if (followUp) {
                needsFollowUp = true;
              }
            } else {
              // Wildcard fallback for undefined tools
              const wildcardTool = this.getTool({ toolName: "*", agentId: agent.agentId });
              if (wildcardTool) {
                const followUp = await this.executeWildcardTool(wildcardTool, toolCall, message, agent, agentId);
                if (followUp) {
                  needsFollowUp = true;
                }
              }
            }
          }
        }
      }
    }

    if (needsFollowUp) {
      return await this.runAgent({ agent });
    }

    void (this.core as unknown as CopilotKitCoreFriendsAccess).suggestionEngine.reloadSuggestions(agentId);

    return runAgentResult;
  }

  /**
   * Execute a specific tool
   */
  private async executeSpecificTool(
    tool: FrontendTool<any>,
    toolCall: any,
    message: Message,
    agent: AbstractAgent,
    agentId: string,
  ): Promise<boolean> {
    // Check if tool is constrained to a specific agent
    if (tool?.agentId && tool.agentId !== agent.agentId) {
      // Tool is not available for this agent, skip it
      return false;
    }

    let toolCallResult = "";
    let errorMessage: string | undefined;
    let isArgumentError = false;

    if (tool?.handler) {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        const parseError = error instanceof Error ? error : new Error(String(error));
        errorMessage = parseError.message;
        isArgumentError = true;
        await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
          error: parseError,
          code: CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED,
          context: {
            agentId: agentId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            rawArguments: toolCall.function.arguments,
            toolType: "specific",
            messageId: message.id,
          },
        });
      }

      await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
        (subscriber) =>
          subscriber.onToolExecutionStart?.({
            copilotkit: this.core,
            toolCallId: toolCall.id,
            agentId: agentId,
            toolName: toolCall.function.name,
            args: parsedArgs,
          }),
        "Subscriber onToolExecutionStart error:",
      );

      if (!errorMessage) {
        try {
          const result = await tool.handler(parsedArgs as any, toolCall);
          if (result === undefined || result === null) {
            toolCallResult = "";
          } else if (typeof result === "string") {
            toolCallResult = result;
          } else {
            toolCallResult = JSON.stringify(result);
          }
        } catch (error) {
          const handlerError = error instanceof Error ? error : new Error(String(error));
          errorMessage = handlerError.message;
          await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
            error: handlerError,
            code: CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
            context: {
              agentId: agentId,
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              parsedArgs,
              toolType: "specific",
              messageId: message.id,
            },
          });
        }
      }

      if (errorMessage) {
        toolCallResult = `Error: ${errorMessage}`;
      }

      await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
        (subscriber) =>
          subscriber.onToolExecutionEnd?.({
            copilotkit: this.core,
            toolCallId: toolCall.id,
            agentId: agentId,
            toolName: toolCall.function.name,
            result: errorMessage ? "" : toolCallResult,
            error: errorMessage,
          }),
        "Subscriber onToolExecutionEnd error:",
      );

      if (isArgumentError) {
        throw new Error(errorMessage ?? "Tool execution failed");
      }
    }

    if (!errorMessage || !isArgumentError) {
      const messageIndex = agent.messages.findIndex((m) => m.id === message.id);
      const toolMessage = {
        id: randomUUID(),
        role: "tool" as const,
        toolCallId: toolCall.id,
        content: toolCallResult,
      };
      agent.messages.splice(messageIndex + 1, 0, toolMessage);

      if (!errorMessage && tool?.followUp !== false) {
        return true; // Needs follow-up
      }
    }

    return false;
  }

  /**
   * Execute a wildcard tool
   */
  private async executeWildcardTool(
    wildcardTool: FrontendTool<any>,
    toolCall: any,
    message: Message,
    agent: AbstractAgent,
    agentId: string,
  ): Promise<boolean> {
    // Check if wildcard tool is constrained to a specific agent
    if (wildcardTool?.agentId && wildcardTool.agentId !== agent.agentId) {
      // Wildcard tool is not available for this agent, skip it
      return false;
    }

    let toolCallResult = "";
    let errorMessage: string | undefined;
    let isArgumentError = false;

    if (wildcardTool?.handler) {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        const parseError = error instanceof Error ? error : new Error(String(error));
        errorMessage = parseError.message;
        isArgumentError = true;
        await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
          error: parseError,
          code: CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED,
          context: {
            agentId: agentId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            rawArguments: toolCall.function.arguments,
            toolType: "wildcard",
            messageId: message.id,
          },
        });
      }

      const wildcardArgs = {
        toolName: toolCall.function.name,
        args: parsedArgs,
      };

      await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
        (subscriber) =>
          subscriber.onToolExecutionStart?.({
            copilotkit: this.core,
            toolCallId: toolCall.id,
            agentId: agentId,
            toolName: toolCall.function.name,
            args: wildcardArgs,
          }),
        "Subscriber onToolExecutionStart error:",
      );

      if (!errorMessage) {
        try {
          const result = await wildcardTool.handler(wildcardArgs as any, toolCall);
          if (result === undefined || result === null) {
            toolCallResult = "";
          } else if (typeof result === "string") {
            toolCallResult = result;
          } else {
            toolCallResult = JSON.stringify(result);
          }
        } catch (error) {
          const handlerError = error instanceof Error ? error : new Error(String(error));
          errorMessage = handlerError.message;
          await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
            error: handlerError,
            code: CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
            context: {
              agentId: agentId,
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              parsedArgs: wildcardArgs,
              toolType: "wildcard",
              messageId: message.id,
            },
          });
        }
      }

      if (errorMessage) {
        toolCallResult = `Error: ${errorMessage}`;
      }

      await (this.core as unknown as CopilotKitCoreFriendsAccess).notifySubscribers(
        (subscriber) =>
          subscriber.onToolExecutionEnd?.({
            copilotkit: this.core,
            toolCallId: toolCall.id,
            agentId: agentId,
            toolName: toolCall.function.name,
            result: errorMessage ? "" : toolCallResult,
            error: errorMessage,
          }),
        "Subscriber onToolExecutionEnd error:",
      );

      if (isArgumentError) {
        throw new Error(errorMessage ?? "Tool execution failed");
      }
    }

    if (!errorMessage || !isArgumentError) {
      const messageIndex = agent.messages.findIndex((m) => m.id === message.id);
      const toolMessage = {
        id: randomUUID(),
        role: "tool" as const,
        toolCallId: toolCall.id,
        content: toolCallResult,
      };
      agent.messages.splice(messageIndex + 1, 0, toolMessage);

      if (!errorMessage && wildcardTool?.followUp !== false) {
        return true; // Needs follow-up
      }
    }

    return false;
  }

  /**
   * Build frontend tools for an agent
   */
  buildFrontendTools(agentId?: string): Tool[] {
    return this._tools
      .filter((tool) => !tool.agentId || tool.agentId === agentId)
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: createToolSchema(tool),
      }));
  }

  /**
   * Create an agent error subscriber
   */
  private createAgentErrorSubscriber(agent: AbstractAgent): AgentSubscriber {
    const emitAgentError = async (
      error: Error,
      code: CopilotKitCoreErrorCode,
      extraContext: Record<string, any> = {},
    ) => {
      const context: Record<string, any> = { ...extraContext };
      if (agent.agentId) {
        context.agentId = agent.agentId;
      }
      await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
        error,
        code,
        context,
      });
    };

    return {
      onRunFailed: async ({ error }: { error: Error }) => {
        await emitAgentError(error, CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT, {
          source: "onRunFailed",
        });
      },
      onRunErrorEvent: async ({ event }) => {
        const eventError =
          event?.rawEvent instanceof Error
            ? event.rawEvent
            : event?.rawEvent?.error instanceof Error
              ? event.rawEvent.error
              : undefined;

        const errorMessage =
          typeof event?.rawEvent?.error === "string" ? event.rawEvent.error : (event?.message ?? "Agent run error");

        const rawError = eventError ?? new Error(errorMessage);

        if (event?.code && !(rawError as any).code) {
          (rawError as any).code = event.code;
        }

        await emitAgentError(rawError, CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT, {
          source: "onRunErrorEvent",
          event,
          runtimeErrorCode: event?.code,
        });
      },
    };
  }
}

/**
 * Empty tool schema constant
 */
const EMPTY_TOOL_SCHEMA = {
  type: "object",
  properties: {},
} as const satisfies Record<string, unknown>;

/**
 * Create a JSON schema from a tool's parameters
 */
function createToolSchema(tool: FrontendTool<any>): Record<string, unknown> {
  if (!tool.parameters) {
    return { ...EMPTY_TOOL_SCHEMA };
  }

  const rawSchema = zodToJsonSchema(tool.parameters, {
    $refStrategy: "none",
  });

  if (!rawSchema || typeof rawSchema !== "object") {
    return { ...EMPTY_TOOL_SCHEMA };
  }

  const { $schema, ...schema } = rawSchema as Record<string, unknown>;

  if (typeof schema.type !== "string") {
    schema.type = "object";
  }
  if (typeof schema.properties !== "object" || schema.properties === null) {
    schema.properties = {};
  }

  stripAdditionalProperties(schema);
  return schema;
}

function stripAdditionalProperties(schema: unknown): void {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (Array.isArray(schema)) {
    schema.forEach(stripAdditionalProperties);
    return;
  }

  const record = schema as Record<string, unknown>;

  if (record.additionalProperties !== undefined) {
    delete record.additionalProperties;
  }

  for (const value of Object.values(record)) {
    stripAdditionalProperties(value);
  }
}
