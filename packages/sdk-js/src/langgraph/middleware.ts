import { createMiddleware, AIMessage, SystemMessage } from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import * as z from "zod";

const createAppContextBeforeAgent = (state, runtime) => {
  const messages = state.messages;

  if (!messages || messages.length === 0) {
    return;
  }

  // Get app context from runtime
  const appContext = state["copilotkit"]?.context ?? runtime?.context;

  // Check if appContext is missing or empty
  const isEmptyContext =
    !appContext ||
    (typeof appContext === "string" && appContext.trim() === "") ||
    (typeof appContext === "object" && Object.keys(appContext).length === 0);

  if (isEmptyContext) {
    return;
  }

  // Create the context content
  const contextContent =
    typeof appContext === "string"
      ? appContext
      : JSON.stringify(appContext, null, 2);
  const contextMessageContent = `App Context:\n${contextContent}`;
  const contextMessagePrefix = "App Context:\n";

  // Helper to get message content as string
  const getContentString = (msg: any): string | null => {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content) && msg.content[0]?.text)
      return msg.content[0].text;
    return null;
  };

  // Find the first system/developer message (not our context message) to determine
  // where to insert our context message (right after it)
  let firstSystemIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const type = msg._getType?.();
    if (type === "system" || type === "developer") {
      const content = getContentString(msg);
      // Skip if this is our own context message
      if (content?.startsWith(contextMessagePrefix)) {
        continue;
      }
      firstSystemIndex = i;
      break;
    }
  }

  // Check if our context message already exists
  let existingContextIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const type = msg._getType?.();
    if (type === "system" || type === "developer") {
      const content = getContentString(msg);
      if (content?.startsWith(contextMessagePrefix)) {
        existingContextIndex = i;
        break;
      }
    }
  }

  // Create the context message
  const contextMessage = new SystemMessage({ content: contextMessageContent });

  let updatedMessages;

  if (existingContextIndex !== -1) {
    // Replace existing context message
    updatedMessages = [...messages];
    updatedMessages[existingContextIndex] = contextMessage;
  } else {
    // Insert after the first system message, or at position 0 if no system message
    const insertIndex = firstSystemIndex !== -1 ? firstSystemIndex + 1 : 0;
    updatedMessages = [
      ...messages.slice(0, insertIndex),
      contextMessage,
      ...messages.slice(insertIndex),
    ];
  }

  return {
    ...state,
    messages: updatedMessages,
  };
};

/**
 * CopilotKit Middleware for LangGraph agents.
 *
 * Enables:
 * - Dynamic frontend tools from state.tools
 * - Context provided from CopilotKit useCopilotReadable
 *
 * Works with any agent (prebuilt or custom).
 *
 * @example
 * ```typescript
 * import { createAgent } from "langchain";
 * import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";
 *
 * const agent = createAgent({
 *   model: "gpt-4o",
 *   tools: [backendTool],
 *   middleware: [copilotkitMiddleware],
 * });
 * ```
 */
const copilotKitStateSchema = z.object({
  copilotkit: z
    .object({
      actions: z.array(z.any()),
      context: z.any().optional(),
      interceptedToolCalls: z.array(z.any()).optional(),
      originalAIMessageId: z.string().optional(),
    })
    .optional(),
});

const middlewareInput = {
  name: "CopilotKitMiddleware",

  stateSchema: copilotKitStateSchema as unknown as InteropZodObject,

  // Inject frontend tools before model call
  wrapModelCall: async (request, handler) => {
    const frontendTools = request.state["copilotkit"]?.actions ?? [];

    if (frontendTools.length === 0) {
      return handler(request);
    }

    const existingTools = request.tools || [];
    const mergedTools = [...existingTools, ...frontendTools];

    return handler({
      ...request,
      tools: mergedTools,
    });
  },

  beforeAgent: createAppContextBeforeAgent,

  // Restore frontend tool calls to AIMessage before agent exits
  afterAgent: (state) => {
    const interceptedToolCalls = state["copilotkit"]?.interceptedToolCalls;
    const originalMessageId = state["copilotkit"]?.originalAIMessageId;

    if (!interceptedToolCalls?.length || !originalMessageId) {
      return;
    }

    let messageFound = false;
    const updatedMessages = state.messages.map((msg: any) => {
      if (AIMessage.isInstance(msg) && msg.id === originalMessageId) {
        messageFound = true;
        const existingToolCalls = msg.tool_calls || [];
        return new AIMessage({
          content: msg.content,
          tool_calls: [...existingToolCalls, ...interceptedToolCalls],
          id: msg.id,
        });
      }
      return msg;
    });

    // Only clear intercepted state if we successfully restored the tool calls
    if (!messageFound) {
      console.warn(
        `CopilotKit: Could not find message with id ${originalMessageId} to restore tool calls`,
      );
      return;
    }

    return {
      messages: updatedMessages,
      copilotkit: {
        ...(state["copilotkit"] ?? {}),
        interceptedToolCalls: undefined,
        originalAIMessageId: undefined,
      },
    };
  },

  // Intercept frontend tool calls after model returns, before ToolNode executes
  afterModel: (state) => {
    const frontendTools = state["copilotkit"]?.actions ?? [];
    if (frontendTools.length === 0) return;

    const frontendToolNames = new Set(
      frontendTools.map((t: any) => t.function?.name || t.name),
    );

    const lastMessage = state.messages[state.messages.length - 1];
    if (!AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
      return;
    }

    const backendToolCalls: any[] = [];
    const frontendToolCalls: any[] = [];

    for (const call of lastMessage.tool_calls) {
      if (frontendToolNames.has(call.name)) {
        frontendToolCalls.push(call);
      } else {
        backendToolCalls.push(call);
      }
    }

    if (frontendToolCalls.length === 0) return;

    const updatedAIMessage = new AIMessage({
      content: lastMessage.content,
      tool_calls: backendToolCalls,
      id: lastMessage.id,
    });

    return {
      messages: [...state.messages.slice(0, -1), updatedAIMessage],
      copilotkit: {
        ...(state["copilotkit"] ?? {}),
        interceptedToolCalls: frontendToolCalls,
        originalAIMessageId: lastMessage.id,
      },
    };
  },
} as any;
const createCopilotKitMiddleware = () => {
  return createMiddleware(middlewareInput);
};

export const copilotkitMiddleware = createCopilotKitMiddleware();
