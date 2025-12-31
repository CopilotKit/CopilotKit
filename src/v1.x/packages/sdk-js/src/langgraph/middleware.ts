import { createMiddleware, AIMessage } from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import * as z from "zod";

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

const createCopilotKitMiddleware = () => {
  return createMiddleware({
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

      const frontendToolNames = new Set(frontendTools.map((t: any) => t.function?.name || t.name));

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
  });
};

export const copilotkitMiddleware = createCopilotKitMiddleware();
