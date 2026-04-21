import {
  AbstractAgent,
  AgentSubscriber,
  HttpAgent,
  Message,
  RunAgentResult,
  Tool,
  ToolCall,
} from "@ag-ui/client";
import { randomUUID, logger, schemaToJsonSchema } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CopilotKitCore, CopilotKitCoreFriendsAccess } from "./core";
import { CopilotKitCoreErrorCode } from "./core";
import { AgentThreadLockedError } from "../intelligence-agent";
import type { FrontendTool } from "../types";

export interface CopilotKitCoreRunAgentParams {
  agent: AbstractAgent;
  forwardedProps?: Record<string, unknown>;
}

export interface CopilotKitCoreConnectAgentParams {
  agent: AbstractAgent;
}

export interface CopilotKitCoreGetToolParams {
  toolName: string;
  agentId?: string;
}

/**
 * Parameters for programmatic tool execution via `copilotkit.runTool()`.
 */
export interface CopilotKitCoreRunToolParams {
  /** Name of the registered frontend tool to execute. */
  name: string;
  /** Optional agent ID. If omitted, uses the default agent lookup. */
  agentId?: string;
  /** Parameters to pass to the tool handler. */
  parameters?: Record<string, unknown>;
  /**
   * Whether to trigger an LLM follow-up after tool execution.
   * - `false` (default): execute tool, add messages to history, done.
   * - `"generate"`: after execution, trigger another agent run so the LLM responds to the tool result.
   * - Any other string: add a user message with this text, then trigger another agent run.
   */
  followUp?: string | false;
}

/**
 * Result of programmatic tool execution via `copilotkit.runTool()`.
 */
export interface CopilotKitCoreRunToolResult {
  /** The unique ID of the tool call. */
  toolCallId: string;
  /** The stringified result from the tool handler. */
  result: string;
  /** Error message if the handler failed. */
  error?: string;
}

/**
 * Internal result from the shared tool handler execution logic.
 */
interface ExecuteToolHandlerResult {
  result: string;
  error?: string;
  isArgumentError: boolean;
}

/**
 * Handles agent execution, tool calling, and agent connectivity for CopilotKitCore.
 * Manages the complete lifecycle of agent runs including tool execution and follow-ups.
 */
export class RunHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _tools: FrontendTool<any>[] = [];

  /**
   * Tracks whether the current run (including in-flight tool execution)
   * has been aborted via `stopAgent()` or `agent.abortRun()`. Created
   * fresh in `runAgent()`, aborted by `abortCurrentRun()`.
   */
  private _runAbortController: AbortController | null = null;

  /**
   * Tracks recursive `runAgent` depth so that the abort controller and
   * `agent.abortRun()` intercept are only set up / torn down at the
   * top-level call, not on follow-up recursive calls from
   * `processAgentResult`.
   */
  private _runDepth = 0;

  constructor(private core: CopilotKitCore) {}

  /**
   * Abort the current run. Called by `CopilotKitCore.stopAgent()` to signal
   * that in-flight tool handlers should stop and `processAgentResult` should
   * not start a follow-up run.
   */
  abortCurrentRun(): void {
    this._runAbortController?.abort();
  }

  /**
   * Typed access to CopilotKitCore's internal ("friend") methods.
   * Centralises the single unavoidable cast so call-sites stay clean.
   */
  private get _internal(): CopilotKitCoreFriendsAccess {
    return this.core as unknown as CopilotKitCoreFriendsAccess;
  }

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
  addTool<T extends Record<string, unknown> = Record<string, unknown>>(
    tool: FrontendTool<T>,
  ): void {
    // Check if a tool with the same name and agentId already exists
    const existingToolIndex = this._tools.findIndex(
      (t) => t.name === tool.name && t.agentId === tool.agentId,
    );

    if (existingToolIndex !== -1) {
      logger.warn(
        `Tool already exists: '${tool.name}' for agent '${tool.agentId || "global"}', skipping.`,
      );
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
      const agentTool = this._tools.find(
        (tool) => tool.name === toolName && tool.agentId === agentId,
      );
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
  async connectAgent({
    agent,
  }: CopilotKitCoreConnectAgentParams): Promise<RunAgentResult> {
    try {
      // Detach any active run before connecting to avoid previous runs interfering
      await agent.detachActiveRun();
      agent.setMessages([]);
      agent.setState({});

      if (agent instanceof HttpAgent) {
        agent.headers = {
          ...this._internal.headers,
        };
      }

      // Notify subscribers (e.g. the inspector) about the agent that is about
      // to run. This is critical for per-thread clones that are not present in
      // the agent registry and would otherwise be invisible to subscribers.
      await this._internal.notifySubscribers(
        (subscriber) =>
          subscriber.onAgentRunStarted?.({
            copilotkit: this.core,
            agent,
          }),
        "Subscriber onAgentRunStarted error:",
      );

      const runAgentResult = await agent.connectAgent(
        {
          forwardedProps: this._internal.properties,
          tools: this.buildFrontendTools(agent.agentId),
          context: Object.values(this._internal.context),
        },
        this.createAgentErrorSubscriber(agent),
      );

      return this.processAgentResult({ runAgentResult, agent });
    } catch (error) {
      const connectError =
        error instanceof Error ? error : new Error(String(error));
      // Silently ignore abort errors (e.g. from navigation during active requests)
      const isAbort =
        connectError.name === "AbortError" ||
        connectError.message === "Fetch is aborted" ||
        connectError.message === "signal is aborted without reason" ||
        connectError.message === "component unmounted";
      if (!isAbort) {
        const context: Record<string, any> = {};
        if (agent.agentId) {
          context.agentId = agent.agentId;
        }
        await this._internal.emitError({
          error: connectError,
          code: CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED,
          context,
        });
      }
      return { newMessages: [] };
    }
  }

  /**
   * Run an agent
   */
  async runAgent({
    agent,
    forwardedProps,
  }: CopilotKitCoreRunAgentParams): Promise<RunAgentResult> {
    // Agent ID is guaranteed to be set by validateAndAssignAgentId
    if (agent.agentId) {
      void this._internal.suggestionEngine.clearSuggestions(agent.agentId);
    }

    if (agent instanceof HttpAgent) {
      agent.headers = {
        ...this._internal.headers,
      };
    }

    // Detach any active run (e.g. a long-lived connectAgent pipeline) before
    // starting a new run.  We await the detach to ensure the previous pipeline
    // has fully finalized — its activeRunCompletionPromise resolves once the
    // observable finalize block runs, which happens synchronously after the
    // takeUntil signal completes the chain.  This prevents a race where the new
    // runAgent() overwrites activeRunDetach$ / activeRunCompletionPromise before
    // the old pipeline can clean up, causing dropped runs.
    //
    // Historical note: an earlier version used fire-and-forget (`void`) here
    // because awaiting caused a deadlock when connectAgent's
    // ConnectNotImplementedError cleanup was still in-flight.  That deadlock
    // was resolved in @ag-ui/client ≥0.0.42 where the catchError path
    // (ConnectNotImplementedError → EMPTY) always runs the finalize block,
    // so the completion promise now resolves reliably.
    if (agent.detachActiveRun) {
      await agent.detachActiveRun();
    }

    // Ensure the state manager is subscribed to this agent (handles per-thread
    // clones that are not in the registry and therefore not subscribed via
    // onAgentsChanged). The composite-key logic in StateManager means this
    // does not overwrite the registry agent's subscription.
    this._internal.subscribeAgentToStateManager(agent);

    // Notify subscribers (e.g. the web inspector) that a run is about to start
    // on this specific agent instance. Must be awaited so that subscribers can
    // call agent.subscribe() before agent.runAgent() captures its subscriber
    // snapshot — agent.runAgent() snapshots [this.subscribers] synchronously.
    await this._internal.notifySubscribers(
      (subscriber) =>
        subscriber.onAgentRunStarted?.({ copilotkit: this.core, agent }),
      "Subscriber onAgentRunStarted error:",
    );

    // Set up abort controller and agent.abortRun() intercept only for the
    // top-level call. Recursive follow-up calls from processAgentResult
    // reuse the same controller.
    const isTopLevel = this._runDepth === 0;
    let originalAbortRun: (() => void) | undefined;

    if (isTopLevel) {
      this._runAbortController = new AbortController();

      // Intercept agent.abortRun() so that calling it directly (not via
      // stopAgent) also aborts in-flight tool execution and prevents
      // follow-up runs.
      const controller = this._runAbortController;
      originalAbortRun = agent.abortRun.bind(agent);
      agent.abortRun = () => {
        controller.abort();
        originalAbortRun!();
      };
    }

    this._runDepth++;

    try {
      const runAgentResult = await agent.runAgent(
        {
          forwardedProps: {
            ...this._internal.properties,
            ...forwardedProps,
          },
          tools: this.buildFrontendTools(agent.agentId),
          context: Object.values(this._internal.context),
        },
        this.createAgentErrorSubscriber(agent),
      );
      return await this.processAgentResult({ runAgentResult, agent });
    } catch (error) {
      const runError =
        error instanceof Error ? error : new Error(String(error));
      const context: Record<string, any> = {};
      if (agent.agentId) {
        context.agentId = agent.agentId;
      }
      await this._internal.emitError({
        error: runError,
        code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
        context,
      });
      return { newMessages: [] };
    } finally {
      this._runDepth--;
      // Restore original abortRun when the entire chain (including
      // recursive follow-ups) is complete.
      if (isTopLevel && originalAbortRun) {
        agent.abortRun = originalAbortRun;
      }
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
          if (
            newMessages.findIndex(
              (m) => m.role === "tool" && m.toolCallId === toolCall.id,
            ) === -1
          ) {
            const tool = this.getTool({
              toolName: toolCall.function.name,
              agentId: agent.agentId,
            });
            if (tool) {
              const followUp = await this.executeSpecificTool(
                tool,
                toolCall,
                message,
                agent,
                agentId,
              );
              if (followUp) {
                needsFollowUp = true;
              }
            } else {
              // Wildcard fallback for undefined tools
              const wildcardTool = this.getTool({
                toolName: "*",
                agentId: agent.agentId,
              });
              if (wildcardTool) {
                const followUp = await this.executeWildcardTool(
                  wildcardTool,
                  toolCall,
                  message,
                  agent,
                  agentId,
                );
                if (followUp) {
                  needsFollowUp = true;
                }
              }
            }
          }
        }
      }
    }

    if (needsFollowUp && !this._runAbortController?.signal.aborted) {
      // Yield to the framework scheduler before the follow-up run so that any
      // deferred state updates (e.g. React useEffect in useAgentContext) can
      // complete and write fresh values into the context store before runAgent
      // reads it. The base implementation is a no-op; React overrides this.
      await this._internal.waitForPendingFrameworkUpdates();
      return await this.runAgent({ agent });
    }

    void this._internal.suggestionEngine.reloadSuggestions(agentId, agent);

    return runAgentResult;
  }

  /**
   * Shared handler execution logic used by executeSpecificTool, executeWildcardTool, and runTool.
   * Handles arg parsing, subscriber notifications, handler invocation, result stringification,
   * and error handling.
   */
  private async executeToolHandler({
    tool,
    toolCall,
    agent,
    agentId,
    handlerArgs,
    toolType,
    messageId,
  }: {
    tool: FrontendTool<any>;
    toolCall: { id: string; function: { name: string; arguments: string } };
    agent: AbstractAgent;
    agentId: string;
    handlerArgs: unknown;
    toolType: string;
    messageId?: string;
  }): Promise<ExecuteToolHandlerResult> {
    let toolCallResult = "";
    let errorMessage: string | undefined;
    let isArgumentError = false;

    let parsedArgs: unknown;
    try {
      parsedArgs = parseToolArguments(handlerArgs, toolCall.function.name);
    } catch (error) {
      const parseError =
        error instanceof Error ? error : new Error(String(error));
      errorMessage = parseError.message;
      isArgumentError = true;
      await this._internal.emitError({
        error: parseError,
        code: CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED,
        context: {
          agentId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          rawArguments: handlerArgs,
          toolType,
          ...(messageId ? { messageId } : {}),
        },
      });
    }

    await this._internal.notifySubscribers(
      (subscriber) =>
        subscriber.onToolExecutionStart?.({
          copilotkit: this.core,
          toolCallId: toolCall.id,
          agentId,
          toolName: toolCall.function.name,
          args: parsedArgs,
        }),
      "Subscriber onToolExecutionStart error:",
    );

    if (!errorMessage) {
      try {
        const result = await tool.handler!(parsedArgs as any, {
          toolCall: toolCall as any,
          agent,
          signal: this._runAbortController?.signal,
        });
        if (result === undefined || result === null) {
          toolCallResult = "";
        } else if (typeof result === "string") {
          toolCallResult = result;
        } else {
          toolCallResult = JSON.stringify(result);
        }
      } catch (error) {
        const handlerError =
          error instanceof Error ? error : new Error(String(error));
        errorMessage = handlerError.message;
        await this._internal.emitError({
          error: handlerError,
          code: CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
          context: {
            agentId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            parsedArgs,
            toolType,
            ...(messageId ? { messageId } : {}),
          },
        });
      }
    }

    if (errorMessage) {
      toolCallResult = `Error: ${errorMessage}`;
    }

    await this._internal.notifySubscribers(
      (subscriber) =>
        subscriber.onToolExecutionEnd?.({
          copilotkit: this.core,
          toolCallId: toolCall.id,
          agentId,
          toolName: toolCall.function.name,
          result: errorMessage ? "" : toolCallResult,
          error: errorMessage,
        }),
      "Subscriber onToolExecutionEnd error:",
    );

    return { result: toolCallResult, error: errorMessage, isArgumentError };
  }

  /**
   * Execute a specific tool
   */
  private async executeSpecificTool(
    tool: FrontendTool<any>,
    toolCall: ToolCall,
    message: Message,
    agent: AbstractAgent,
    agentId: string,
  ): Promise<boolean> {
    // Check if tool is constrained to a specific agent
    if (tool?.agentId && tool.agentId !== agent.agentId) {
      // Tool is not available for this agent, skip it
      return false;
    }

    let handlerResult: ExecuteToolHandlerResult = {
      result: "",
      error: undefined,
      isArgumentError: false,
    };

    if (tool?.handler) {
      handlerResult = await this.executeToolHandler({
        tool,
        toolCall,
        agent,
        agentId,
        handlerArgs: toolCall.function.arguments,
        toolType: "specific",
        messageId: message.id,
      });
    }

    {
      const messageIndex = agent.messages.findIndex((m) => m.id === message.id);
      if (messageIndex === -1) {
        // Parent message no longer in agent's messages (e.g. thread was switched
        // while the tool handler was still executing). Skip result insertion and
        // do not request a follow-up to avoid mutating the wrong thread.
        return false;
      }
      const toolMessage = {
        id: randomUUID(),
        role: "tool" as const,
        toolCallId: toolCall.id,
        content: handlerResult.result,
      };
      agent.messages.splice(messageIndex + 1, 0, toolMessage);

      if (!handlerResult.error && tool?.followUp !== false) {
        return true; // Needs follow-up
      }
    }

    return false;
  }

  /**
   * Execute a wildcard tool.
   * Wildcard tools receive args wrapped as `{toolName, args}`, which differs from
   * specific tools, so this method keeps its own arg-wrapping logic rather than
   * delegating to `executeToolHandler`.
   */
  private async executeWildcardTool(
    wildcardTool: FrontendTool<any>,
    toolCall: ToolCall,
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
        parsedArgs = parseToolArguments(
          toolCall.function.arguments,
          toolCall.function.name,
        );
      } catch (error) {
        const parseError =
          error instanceof Error ? error : new Error(String(error));
        errorMessage = parseError.message;
        isArgumentError = true;
        await this._internal.emitError({
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

      await this._internal.notifySubscribers(
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
          const result = await wildcardTool.handler(wildcardArgs as any, {
            toolCall,
            agent,
          });
          if (result === undefined || result === null) {
            toolCallResult = "";
          } else if (typeof result === "string") {
            toolCallResult = result;
          } else {
            toolCallResult = JSON.stringify(result);
          }
        } catch (error) {
          const handlerError =
            error instanceof Error ? error : new Error(String(error));
          errorMessage = handlerError.message;
          await this._internal.emitError({
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

      await this._internal.notifySubscribers(
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
    }

    {
      const messageIndex = agent.messages.findIndex((m) => m.id === message.id);
      if (messageIndex === -1) {
        // Parent message no longer in agent's messages (e.g. thread was switched
        // while the tool handler was still executing). Skip result insertion and
        // do not request a follow-up to avoid mutating the wrong thread.
        return false;
      }
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
   * Programmatically execute a registered frontend tool without going through an LLM turn.
   * The handler runs, render components show up in the UI, and both the tool call and
   * result messages are added to `agent.messages`.
   */
  async runTool(
    params: CopilotKitCoreRunToolParams,
  ): Promise<CopilotKitCoreRunToolResult> {
    const { name, agentId, parameters = {}, followUp = false } = params;

    // 1. Look up the tool
    const tool = this.getTool({ toolName: name, agentId });
    if (!tool) {
      const error = new Error(`Tool not found: ${name}`);
      await this._internal.emitError({
        error,
        code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
        context: { toolName: name, agentId },
      });
      throw error;
    }

    // 2. Look up the agent
    const resolvedAgentId = agentId ?? "default";
    const agent = this._internal.getAgent(resolvedAgentId);
    if (!agent) {
      const error = new Error(`Agent not found: ${resolvedAgentId}`);
      await this._internal.emitError({
        error,
        code: CopilotKitCoreErrorCode.AGENT_NOT_FOUND,
        context: { agentId: resolvedAgentId },
      });
      throw error;
    }

    // 3. Create assistant message with tool call
    const toolCallId = randomUUID();
    const assistantMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(parameters),
          },
        },
      ],
    };

    // 4. Push assistant message into agent's messages
    agent.messages.push(assistantMessage);

    // 5. Execute the tool handler (if it has one)
    let handlerResult: ExecuteToolHandlerResult = {
      result: "",
      error: undefined,
      isArgumentError: false,
    };

    if (tool.handler) {
      handlerResult = await this.executeToolHandler({
        tool,
        toolCall: assistantMessage.toolCalls![0],
        agent,
        agentId: resolvedAgentId,
        handlerArgs: parameters,
        toolType: "runTool",
      });
    }

    // 6. Create and insert tool result message
    const toolResultMessage: Message = {
      id: randomUUID(),
      role: "tool",
      toolCallId,
      content: handlerResult.result,
    };

    const assistantIndex = agent.messages.findIndex(
      (m) => m.id === assistantMessage.id,
    );
    if (assistantIndex !== -1) {
      agent.messages.splice(assistantIndex + 1, 0, toolResultMessage);
    } else {
      // Fallback: push to end if assistant message was removed
      agent.messages.push(toolResultMessage);
    }

    // 7. Handle followUp (only if no error)
    if (!handlerResult.error && followUp !== false) {
      if (typeof followUp === "string" && followUp !== "generate") {
        // Custom text: add a user message first
        const userMessage: Message = {
          id: randomUUID(),
          role: "user",
          content: followUp,
        };
        agent.messages.push(userMessage);
      }
      // Yield to the framework scheduler so deferred state updates (e.g. React
      // useEffect in useAgentContext) can complete before the follow-up run reads
      // the context store. Mirrors the same yield in processAgentResult.
      await this._internal.waitForPendingFrameworkUpdates();
      // Trigger agent run for both "generate" and custom text
      await this.runAgent({ agent });
    }

    // 8. Return result
    return {
      toolCallId,
      result: handlerResult.result,
      error: handlerResult.error,
    };
  }

  /**
   * Build frontend tools for an agent
   */
  buildFrontendTools(agentId?: string): Tool[] {
    return this._tools
      .filter(
        (tool) =>
          tool.available !== false &&
          tool.available !== "disabled" &&
          (!tool.agentId || tool.agentId === agentId),
      )
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
      await this._internal.emitError({
        error,
        code,
        context,
      });
    };

    return {
      onRunFailed: async ({ error }: { error: Error }) => {
        const code =
          error instanceof AgentThreadLockedError
            ? CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED
            : CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT;
        await emitAgentError(error, code, {
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
          typeof event?.rawEvent?.error === "string"
            ? event.rawEvent.error
            : (event?.message ?? "Agent run error");

        const rawError = eventError ?? new Error(errorMessage);

        if (event?.code && !(rawError as any).code) {
          (rawError as any).code = event.code;
        }

        await emitAgentError(
          rawError,
          CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT,
          {
            source: "onRunErrorEvent",
            event,
            runtimeErrorCode: event?.code,
          },
        );
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

  const rawSchema = schemaToJsonSchema(tool.parameters, { zodToJsonSchema });

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

/**
 * Ensures parsed tool arguments are a plain object.
 * Throws for non-object values so the caller's catch block can emit
 * a structured TOOL_ARGUMENT_PARSE_FAILED error.
 *
 * @internal Exported for testing only.
 */
export function ensureObjectArgs(
  parsed: unknown,
  toolName: string,
): Record<string, unknown> {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error(
    `Tool arguments for ${toolName} parsed to non-object (${typeof parsed})`,
  );
}

/**
 * Parses raw tool call arguments into a validated object.
 *
 * Some LLM providers (e.g. @ai-sdk/openai-compatible) may send empty string "",
 * null, or undefined instead of "{}". This function normalises those cases to an
 * empty object so callers don't crash on JSON.parse("").
 *
 * A debug-level warning is emitted when the fallback triggers so silent coercion
 * is observable in logs.
 *
 * @internal Exported for testing only.
 */
export function parseToolArguments(
  rawArgs: unknown,
  toolName: string,
): Record<string, unknown> {
  if (rawArgs === "" || rawArgs === null || rawArgs === undefined) {
    logger.debug(
      `[parseToolArguments] Tool "${toolName}" received empty/null/undefined arguments — defaulting to {}`,
    );
    return {};
  }
  const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
  return ensureObjectArgs(parsed, toolName);
}
