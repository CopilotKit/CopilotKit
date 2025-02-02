import {
  ActionExecutionMessage,
  Message,
  ResultMessage,
  TextMessage,
} from "../../graphql/types/converted";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  BaseMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ActionInput } from "../../graphql/inputs/action.input";
import { LangChainReturnType } from "./types";
import { RuntimeEventSubject } from "../events";
import { randomId, convertJsonSchemaToZodSchema } from "@copilotkit/shared";

export function convertMessageToLangChainMessage(message: Message): BaseMessage {
  if (message.isTextMessage()) {
    if (message.role == "user") {
      return new HumanMessage(message.content);
    } else if (message.role == "assistant") {
      return new AIMessage(message.content);
    } else if (message.role === "system") {
      return new SystemMessage(message.content);
    }
  } else if (message.isActionExecutionMessage()) {
    return new AIMessage({
      content: "",
      tool_calls: [
        {
          id: message.id,
          args: message.arguments,
          name: message.name,
        },
      ],
    });
  } else if (message.isResultMessage()) {
    return new ToolMessage({
      content: message.result,
      tool_call_id: message.actionExecutionId,
    });
  }
}

export function convertActionInputToLangChainTool(actionInput: ActionInput): any {
  return new DynamicStructuredTool({
    name: actionInput.name,
    description: actionInput.description,
    schema: convertJsonSchemaToZodSchema(
      JSON.parse(actionInput.jsonSchema),
      true,
    ) as z.ZodObject<any>,
    func: async () => {
      return "";
    },
  });
}

interface StreamLangChainResponseParams {
  result: LangChainReturnType;
  eventStream$: RuntimeEventSubject;
  actionExecution?: {
    id: string;
    name: string;
  };
}

function getConstructorName(object: any): string {
  if (object && typeof object === "object" && object.constructor && object.constructor.name) {
    return object.constructor.name;
  }
  return "";
}

function isAIMessage(message: any): message is AIMessage {
  return Object.prototype.toString.call(message) === "[object AIMessage]";
}

function isAIMessageChunk(message: any): message is AIMessageChunk {
  return Object.prototype.toString.call(message) === "[object AIMessageChunk]";
}

function isBaseMessageChunk(message: any): message is BaseMessageChunk {
  return Object.prototype.toString.call(message) === "[object BaseMessageChunk]";
}

function maybeSendActionExecutionResultIsMessage(
  eventStream$: RuntimeEventSubject,
  actionExecution?: { id: string; name: string },
) {
  // language models need a result after the function call
  // we simply let them know that we are sending a message
  if (actionExecution) {
    eventStream$.sendActionExecutionResult({
      actionExecutionId: actionExecution.id,
      actionName: actionExecution.name,
      result: "Sending a message",
    });
  }
}

export async function streamLangChainResponse({
  result,
  eventStream$,
  actionExecution,
}: StreamLangChainResponseParams) {
  // We support several types of return values from LangChain functions:

  // 1. string

  if (typeof result === "string") {
    if (!actionExecution) {
      // Just send one chunk with the string as the content.
      eventStream$.sendTextMessage(randomId(), result);
    } else {
      // Send as a result
      eventStream$.sendActionExecutionResult({
        actionExecutionId: actionExecution.id,
        actionName: actionExecution.name,
        result: result,
      });
    }
  }

  // 2. AIMessage
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if (isAIMessage(result)) {
    maybeSendActionExecutionResultIsMessage(eventStream$, actionExecution);

    if (result.content) {
      eventStream$.sendTextMessage(randomId(), result.content as string);
    }
    for (const toolCall of result.tool_calls) {
      eventStream$.sendActionExecution({
        actionExecutionId: toolCall.id || randomId(),
        actionName: toolCall.name,
        args: JSON.stringify(toolCall.args),
      });
    }
  }

  // 3. BaseMessageChunk
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if (isBaseMessageChunk(result)) {
    maybeSendActionExecutionResultIsMessage(eventStream$, actionExecution);

    if (result.lc_kwargs?.content) {
      eventStream$.sendTextMessage(randomId(), result.content as string);
    }
    if (result.lc_kwargs?.tool_calls) {
      for (const toolCall of result.lc_kwargs?.tool_calls) {
        eventStream$.sendActionExecution({
          actionExecutionId: toolCall.id || randomId(),
          actionName: toolCall.name,
          args: JSON.stringify(toolCall.args),
        });
      }
    }
  }

  // 4. IterableReadableStream
  // Stream the result of the LangChain function.
  else if (result && "getReader" in result) {
    maybeSendActionExecutionResultIsMessage(eventStream$, actionExecution);

    let reader = result.getReader();

    let mode: "function" | "message" | null = null;
    let currentMessageId: string;

    const toolCallDetails = {
      name: null,
      id: null,
      index: null,
      prevIndex: null,
    };

    while (true) {
      try {
        const { done, value } = await reader.read();

        let toolCallName: string | undefined = undefined;
        let toolCallId: string | undefined = undefined;
        let toolCallArgs: string | undefined = undefined;
        let hasToolCall: boolean = false;
        let content = "";
        if (value && value.content) {
          content = Array.isArray(value.content)
            ? (((value.content[0] as any)?.text ?? "") as string)
            : value.content;
        }

        if (isAIMessageChunk(value)) {
          let chunk = value.tool_call_chunks?.[0];
          toolCallArgs = chunk?.args;
          hasToolCall = chunk != undefined;
          if (chunk?.name) toolCallDetails.name = chunk.name;
          // track different index on the same tool cool
          if (chunk?.index != null) {
            toolCallDetails.index = chunk.index; // 1
            if (toolCallDetails.prevIndex == null) toolCallDetails.prevIndex = chunk.index;
          }
          // Differentiate when calling the same tool but with different index
          if (chunk?.id)
            toolCallDetails.id = chunk.index != null ? `${chunk.id}-idx-${chunk.index}` : chunk.id;

          // Assign to internal variables that the entire script here knows how to work with
          toolCallName = toolCallDetails.name;
          toolCallId = toolCallDetails.id;
        } else if (isBaseMessageChunk(value)) {
          let chunk = value.additional_kwargs?.tool_calls?.[0];
          toolCallName = chunk?.function?.name;
          toolCallId = chunk?.id;
          toolCallArgs = chunk?.function?.arguments;
          hasToolCall = chunk?.function != undefined;
        }

        // When switching from message to function or vice versa,
        // send the respective end event.
        // If toolCallName is defined, it means a new tool call starts.
        if (mode === "message" && (toolCallId || done)) {
          mode = null;
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
        } else if (mode === "function" && (!hasToolCall || done)) {
          mode = null;
          eventStream$.sendActionExecutionEnd({ actionExecutionId: toolCallId });
        }

        if (done) {
          break;
        }

        // If we send a new message type, send the appropriate start event.
        if (mode === null) {
          if (hasToolCall && toolCallId && toolCallName) {
            mode = "function";
            eventStream$.sendActionExecutionStart({
              actionExecutionId: toolCallId,
              actionName: toolCallName,
              parentMessageId: value.lc_kwargs?.id,
            });
          } else if (content) {
            mode = "message";
            currentMessageId = value.lc_kwargs?.id || randomId();
            eventStream$.sendTextMessageStart({ messageId: currentMessageId });
          }
        }

        // send the content events
        if (mode === "message" && content) {
          eventStream$.sendTextMessageContent({
            messageId: currentMessageId,
            content,
          });
        } else if (mode === "function" && toolCallArgs) {
          // For calls of the same tool with different index, we seal last tool call and register a new one
          if (toolCallDetails.index !== toolCallDetails.prevIndex) {
            eventStream$.sendActionExecutionEnd({ actionExecutionId: toolCallId });
            eventStream$.sendActionExecutionStart({
              actionExecutionId: toolCallId,
              actionName: toolCallName,
              parentMessageId: value.lc_kwargs?.id,
            });
            toolCallDetails.prevIndex = toolCallDetails.index;
          }
          eventStream$.sendActionExecutionArgs({
            actionExecutionId: toolCallId,
            args: toolCallArgs,
          });
        }
      } catch (error) {
        console.error("Error reading from stream", error);
        break;
      }
    }
  } else if (actionExecution) {
    eventStream$.sendActionExecutionResult({
      actionExecutionId: actionExecution.id,
      actionName: actionExecution.name,
      result: encodeResult(result),
    });
  }

  // unsupported type
  else {
    throw new Error("Invalid return type from LangChain function.");
  }

  eventStream$.complete();
}

function encodeResult(result: any): string {
  if (result === undefined) {
    return "";
  } else if (typeof result === "string") {
    return result;
  } else {
    return JSON.stringify(result);
  }
}
