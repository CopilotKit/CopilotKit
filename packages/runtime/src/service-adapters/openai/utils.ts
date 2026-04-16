import type OpenAI from "openai";
import { Message } from "../../graphql/types/converted";
import { ActionInput } from "../../graphql/inputs/action.input";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
  ChatCompletionDeveloperMessageParam,
} from "openai/resources/chat";
import { parseJson } from "@copilotkit/shared";

/**
 * OpenAI v4 exposes streaming completions under `beta.chat.completions`.
 * v5 removed `beta.chat` and promoted streaming to `chat.completions`.
 * These interfaces model the v4-specific shape so we can detect and access
 * the beta namespace safely without `as any`.
 */
interface OpenAIV4BetaChat {
  chat: {
    completions: OpenAI["chat"]["completions"];
  };
}

interface OpenAIV4Beta extends OpenAI.Beta {
  chat: OpenAIV4BetaChat["chat"];
}

/**
 * Type guard: checks whether the OpenAI client has the v4-era `beta.chat`
 * namespace. Returns `false` for v5+ clients where `beta.chat` was removed.
 */
function hasV4BetaChat(beta: OpenAI["beta"] | undefined): beta is OpenAIV4Beta {
  return beta != null && "chat" in beta && (beta as OpenAIV4Beta).chat != null;
}

/**
 * Detects whether the provided OpenAI client is v5+ by checking for the
 * removal of the `beta.chat` namespace (which was promoted to `chat` in v5).
 */
export function isOpenAIV5(openai: OpenAI): boolean {
  return !hasV4BetaChat(openai.beta);
}

/**
 * Returns the chat completions object that supports `.stream()`.
 * In v4 this lives under `openai.beta.chat.completions`;
 * in v5 it was promoted to `openai.chat.completions`.
 */
export function getChatCompletionsForStreaming(
  openai: OpenAI,
): OpenAI["chat"]["completions"] {
  if (hasV4BetaChat(openai.beta)) {
    return openai.beta.chat.completions;
  }
  return openai.chat.completions;
}

/**
 * Retrieves a thread run, handling the v4→v5 API signature change.
 * v4: retrieve(threadId, runId)
 * v5: retrieve(runId, { thread_id: threadId })
 */
export async function retrieveThreadRun(
  openai: OpenAI,
  threadId: string,
  runId: string,
): Promise<OpenAI.Beta.Threads.Runs.Run> {
  if (isOpenAIV5(openai)) {
    // v5 switched to named path params. The type definitions from whichever
    // SDK version is installed won't match both signatures, so we call through
    // a generic function reference. This is the one unavoidable boundary
    // between two incompatible SDK type surfaces.
    const retrieve = openai.beta.threads.runs.retrieve as {
      (...args: unknown[]): Promise<OpenAI.Beta.Threads.Runs.Run>;
    };
    return retrieve(runId, { thread_id: threadId });
  }
  return openai.beta.threads.runs.retrieve(threadId, runId);
}

/**
 * Submits tool outputs as a stream, handling the v4→v5 API signature change.
 * v4: submitToolOutputsStream(threadId, runId, body)
 * v5: submitToolOutputsStream(runId, { thread_id, ...body })
 */
export function submitToolOutputsStream(
  openai: OpenAI,
  threadId: string,
  runId: string,
  body: {
    tool_outputs: Array<{ tool_call_id: string; output: string }>;
    parallel_tool_calls?: false;
  },
) {
  if (isOpenAIV5(openai)) {
    // Same boundary as retrieveThreadRun — v5 uses named path params.
    const submit = openai.beta.threads.runs.submitToolOutputsStream as {
      (
        ...args: unknown[]
      ): ReturnType<typeof openai.beta.threads.runs.submitToolOutputsStream>;
    };
    return submit(runId, { thread_id: threadId, ...body });
  }
  return openai.beta.threads.runs.submitToolOutputsStream(
    threadId,
    runId,
    body,
  );
}

export function limitMessagesToTokenCount(
  messages: any[],
  tools: any[],
  model: string,
  maxTokens?: number,
): any[] {
  maxTokens ||= maxTokensForOpenAIModel(model);

  const result: any[] = [];
  const toolsNumTokens = countToolsTokens(model, tools);
  if (toolsNumTokens > maxTokens) {
    throw new Error(
      `Too many tokens in function definitions: ${toolsNumTokens} > ${maxTokens}`,
    );
  }
  maxTokens -= toolsNumTokens;

  for (const message of messages) {
    if (["system", "developer"].includes(message.role)) {
      const numTokens = countMessageTokens(model, message);
      maxTokens -= numTokens;

      if (maxTokens < 0) {
        throw new Error("Not enough tokens for system message.");
      }
    }
  }

  let cutoff: boolean = false;

  const reversedMessages = [...messages].toReversed();
  for (const message of reversedMessages) {
    if (["system", "developer"].includes(message.role)) {
      result.unshift(message);
      continue;
    } else if (cutoff) {
      continue;
    }
    let numTokens = countMessageTokens(model, message);
    if (maxTokens < numTokens) {
      cutoff = true;
      continue;
    }
    result.unshift(message);
    maxTokens -= numTokens;
  }

  return result;
}

export function maxTokensForOpenAIModel(model: string): number {
  return maxTokensByModel[model] || DEFAULT_MAX_TOKENS;
}

const DEFAULT_MAX_TOKENS = 128000;

const maxTokensByModel: { [key: string]: number } = {
  // o1
  o1: 200000,
  "o1-2024-12-17": 200000,
  "o1-mini": 128000,
  "o1-mini-2024-09-12": 128000,
  "o1-preview": 128000,
  "o1-preview-2024-09-12": 128000,
  // o3-mini
  "o3-mini": 200000,
  "o3-mini-2025-01-31": 200000,
  // GPT-4
  "gpt-4o": 128000,
  "chatgpt-4o-latest": 128000,
  "gpt-4o-2024-08-06": 128000,
  "gpt-4o-2024-05-13": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4o-mini-2024-07-18": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4-turbo-2024-04-09": 128000,
  "gpt-4-0125-preview": 128000,
  "gpt-4-turbo-preview": 128000,
  "gpt-4-1106-preview": 128000,
  "gpt-4-vision-preview": 128000,
  "gpt-4-1106-vision-preview": 128000,
  "gpt-4-32k": 32768,
  "gpt-4-32k-0613": 32768,
  "gpt-4-32k-0314": 32768,
  "gpt-4": 8192,
  "gpt-4-0613": 8192,
  "gpt-4-0314": 8192,

  // GPT-3.5
  "gpt-3.5-turbo-0125": 16385,
  "gpt-3.5-turbo": 16385,
  "gpt-3.5-turbo-1106": 16385,
  "gpt-3.5-turbo-instruct": 4096,
  "gpt-3.5-turbo-16k": 16385,
  "gpt-3.5-turbo-0613": 4096,
  "gpt-3.5-turbo-16k-0613": 16385,
  "gpt-3.5-turbo-0301": 4097,
};

function countToolsTokens(model: string, tools: any[]): number {
  if (tools.length === 0) {
    return 0;
  }
  const json = JSON.stringify(tools);
  return countTokens(model, json);
}

function countMessageTokens(model: string, message: any): number {
  return countTokens(model, message.content || "");
}

function countTokens(model: string, text: string): number {
  return text.length / 3;
}

export function convertActionInputToOpenAITool(
  action: ActionInput,
): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: action.name,
      description: action.description,
      parameters: parseJson(action.jsonSchema, {}),
    },
  };
}

type UsedMessageParams =
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionSystemMessageParam;
export function convertMessageToOpenAIMessage(
  message: Message,
  options?: { keepSystemRole: boolean },
): ChatCompletionMessageParam {
  const { keepSystemRole } = options || { keepSystemRole: false };
  if (message.isTextMessage()) {
    let role = message.role as UsedMessageParams["role"];
    if (message.role === "system" && !keepSystemRole) {
      role = "developer";
    }
    return {
      role,
      content: message.content,
    } satisfies UsedMessageParams;
  } else if (message.isImageMessage()) {
    return {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/${message.format};base64,${message.bytes}`,
          },
        },
      ],
    } satisfies UsedMessageParams;
  } else if (message.isActionExecutionMessage()) {
    return {
      role: "assistant",
      tool_calls: [
        {
          id: message.id,
          type: "function",
          function: {
            name: message.name,
            arguments: JSON.stringify(message.arguments),
          },
        },
      ],
    };
  } else if (message.isResultMessage()) {
    return {
      role: "tool",
      content: message.result,
      tool_call_id: message.actionExecutionId,
    };
  }
}

export function convertSystemMessageToAssistantAPI(
  message: ChatCompletionMessageParam,
) {
  return {
    ...message,
    ...(["system", "developer"].includes(message.role) && {
      role: "assistant",
      content: "THE FOLLOWING MESSAGE IS A SYSTEM MESSAGE: " + message.content,
    }),
  };
}
