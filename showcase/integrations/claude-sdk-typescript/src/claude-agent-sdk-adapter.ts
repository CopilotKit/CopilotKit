import { ClaudeAgentAdapter } from "@ag-ui/claude-agent-sdk";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import {
  createSdkMcpServer,
  tool as sdkTool,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AnyZodRawShape,
  McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod4/v4";
import type { ZodTypeAny } from "zod4/v4";

const COPILOTKIT_MCP_SERVER_NAME = "copilotkit";
const COPILOTKIT_TOOL_PREFIX = `mcp__${COPILOTKIT_MCP_SERVER_NAME}__`;

type Emit = (event: BaseEvent | object) => void;

type ExecuteToolResult = {
  resultText: string;
  state: Record<string, unknown> | null;
};

type ExecuteTool = (
  toolName: string,
  toolInput: Record<string, unknown>,
  state: Record<string, unknown>,
  emit: Emit,
) => Promise<ExecuteToolResult>;

export function shouldUseClaudeAgentSdk({
  input,
  forwardedHeaders,
  runtimeToolCount,
  enableThinking,
}: {
  input: RunAgentInput;
  forwardedHeaders: Record<string, string>;
  runtimeToolCount: number;
  enableThinking?: boolean;
}): boolean {
  if ((process.env.ANTHROPIC_BASE_URL ?? "").includes("aimock")) {
    return false;
  }
  // The official adapter keeps a `headers` property for forward compatibility,
  // but the Claude Agent SDK cannot forward per-request HTTP headers today.
  if (hasHeader(forwardedHeaders, "x-aimock-context")) {
    return false;
  }
  if (enableThinking) {
    return false;
  }
  // The official Claude Agent SDK path can execute backend MCP tools, but it
  // does not yet bridge CopilotKit frontend/runtime tools back through AG-UI.
  if (runtimeToolCount > 0) {
    return false;
  }
  if (hasStructuredUserContent(input)) {
    return false;
  }
  return true;
}

// @region[claude-agent-sdk-typescript-adapter]
// @region[claude-agent-sdk-agent-setup]
export async function runWithClaudeAgentSdk({
  input,
  emit,
  runId,
  threadId,
  systemPrompt,
  toolSchemas,
  initialState,
  model,
  executeTool,
  forwardedHeaders,
}: {
  input: RunAgentInput;
  emit: Emit;
  runId: string;
  threadId: string;
  systemPrompt: string;
  toolSchemas: Anthropic.Tool[];
  initialState: Record<string, unknown>;
  model: string;
  executeTool: ExecuteTool;
  forwardedHeaders?: Record<string, string>;
}): Promise<void> {
  let state = { ...initialState };
  const pendingStateSnapshots: Record<string, unknown>[] = [];
  const backendToolServer = buildBackendToolServer({
    toolSchemas,
    emit,
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
      pendingStateSnapshots.push(state);
    },
    executeTool,
  });

  const adapter = new ClaudeAgentAdapter({
    agentId: "claude-sdk-typescript",
    model: normalizeClaudeAgentSdkModel(model),
    systemPrompt,
    tools: [],
    mcpServers: backendToolServer.mcpServers,
    allowedTools: backendToolServer.allowedTools,
    permissionMode: "dontAsk",
    maxTurns: 10,
  });

  if (forwardedHeaders && Object.keys(forwardedHeaders).length > 0) {
    adapter.headers = forwardedHeaders;
  }

  const runInput: RunAgentInput = {
    ...input,
    runId,
    threadId,
    state: input.state ?? initialState,
  };

  await new Promise<void>((resolve) => {
    adapter.run(runInput).subscribe({
      next: (event) => {
        if (event.type === EventType.TOOL_CALL_RESULT) {
          const snapshot = pendingStateSnapshots.shift();
          if (snapshot) {
            emit({ type: EventType.STATE_SNAPSHOT, snapshot });
          }
        }
        emit(event);
      },
      error: (error) => {
        const message =
          error instanceof Error ? error.stack || error.message : String(error);
        emit({ type: EventType.RUN_ERROR, runId, threadId, message });
        resolve();
      },
      complete: () => resolve(),
    });
  });
}
// @endregion[claude-agent-sdk-agent-setup]

function buildBackendToolServer({
  toolSchemas,
  emit,
  getState,
  setState,
  executeTool,
}: {
  toolSchemas: Anthropic.Tool[];
  emit: Emit;
  getState: () => Record<string, unknown>;
  setState: (state: Record<string, unknown>) => void;
  executeTool: ExecuteTool;
}): {
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools: string[];
} {
  if (toolSchemas.length === 0) {
    return { allowedTools: [] };
  }

  const tools = toolSchemas.map((schema) =>
    sdkTool(
      schema.name,
      schema.description ?? "",
      zodShapeFromJsonSchema(schema.input_schema),
      async (args) => {
        try {
          const result = await executeTool(
            schema.name,
            args as Record<string, unknown>,
            getState(),
            emit,
          );
          if (result.state) {
            setState(result.state);
          }
          return {
            content: [{ type: "text" as const, text: result.resultText }],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      },
    ),
  );

  return {
    mcpServers: {
      [COPILOTKIT_MCP_SERVER_NAME]: createSdkMcpServer({
        name: COPILOTKIT_MCP_SERVER_NAME,
        version: "1.0.0",
        tools,
      }),
    },
    allowedTools: toolSchemas.map(
      (schema) => `${COPILOTKIT_TOOL_PREFIX}${schema.name}`,
    ),
  };
}

function zodShapeFromJsonSchema(
  schema: Anthropic.Tool.InputSchema,
): AnyZodRawShape {
  const properties =
    typeof schema === "object" && schema && "properties" in schema
      ? ((schema as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const required = new Set(
    Array.isArray((schema as { required?: unknown }).required)
      ? ((schema as { required: string[] }).required ?? [])
      : [],
  );
  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, propertySchema] of Object.entries(properties)) {
    const field = zodFromJsonSchema(propertySchema);
    shape[name] = required.has(name) ? field : field.optional();
  }
  return shape as unknown as AnyZodRawShape;
}

function zodFromJsonSchema(schema: unknown): ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }
  const typed = schema as {
    type?: string;
    enum?: unknown[];
    items?: unknown;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (
    typed.enum?.length &&
    typed.enum.every((value) => typeof value === "string")
  ) {
    const values = typed.enum as [string, ...string[]];
    return z.enum(values);
  }
  if (typed.type === "string") return z.string();
  if (typed.type === "number" || typed.type === "integer") return z.number();
  if (typed.type === "boolean") return z.boolean();
  if (typed.type === "array") return z.array(zodFromJsonSchema(typed.items));
  if (typed.type === "object" && typed.properties) {
    const required = new Set(typed.required ?? []);
    const shape: Record<string, ZodTypeAny> = {};
    for (const [name, propertySchema] of Object.entries(typed.properties)) {
      const field = zodFromJsonSchema(propertySchema);
      shape[name] = required.has(name) ? field : field.optional();
    }
    return z.object(shape);
  }
  return z.any();
}

function hasStructuredUserContent(input: RunAgentInput): boolean {
  for (const message of input.messages ?? []) {
    const content = (message as { content?: unknown }).content;
    if (message.role !== "user" || !Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const type = (part as { type?: unknown }).type;
      if (type && type !== "text") return true;
    }
  }
  return false;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function normalizeClaudeAgentSdkModel(model: string): string {
  return model === "claude-sonnet-4.6" ? "claude-sonnet-4-6" : model;
}
// @endregion[claude-agent-sdk-typescript-adapter]
