import { useMemo, useContext, useRef, useEffect, useCallback } from "react";
import { CopilotContext } from "../context/copilot-context";
import { Message, ToolDefinition } from "@copilotkit/shared";
import { SystemMessageFunction } from "../types";
import { UseChatOptions, useChat } from "./use-chat";
import { defaultCopilotContextCategories } from "../components";

export interface UseCopilotChatOptions extends UseChatOptions {
  makeSystemMessage?: SystemMessageFunction;
  additionalInstructions?: string;
}

export interface UseCopilotChatReturn {
  visibleMessages: Message[];
  append: (message: Message) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  isLoading: boolean;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

export function useCopilotChat({
  makeSystemMessage,
  additionalInstructions,
  ...options
}: UseCopilotChatOptions): UseCopilotChatReturn {
  const {
    getContextString,
    getChatCompletionFunctionDescriptions,
    getFunctionCallHandler,
    copilotApiConfig,
    messages,
    setMessages,
  } = useContext(CopilotContext);

  // We need to ensure that makeSystemMessageCallback always uses the latest
  // useCopilotReadable data.
  const latestGetContextString = useUpdatedRef(getContextString);

  const makeSystemMessageCallback = useCallback(() => {
    const systemMessageMaker = makeSystemMessage || defaultSystemMessage;
    // this always gets the latest context string
    const contextString = latestGetContextString.current([], defaultCopilotContextCategories); // TODO: make the context categories configurable

    return {
      id: "system",
      content: systemMessageMaker(contextString, additionalInstructions),
      role: "system",
    } as Message;
  }, [getContextString, makeSystemMessage, additionalInstructions]);

  const functionDescriptions: ToolDefinition[] = useMemo(() => {
    return getChatCompletionFunctionDescriptions();
  }, [getChatCompletionFunctionDescriptions]);

  const { append, reload, stop, isLoading, input, setInput } = useChat({
    ...options,
    copilotConfig: copilotApiConfig,
    id: options.id,
    initialMessages: options.initialMessages || [],
    tools: functionDescriptions,
    onFunctionCall: getFunctionCallHandler(),
    headers: { ...options.headers },
    body: {
      ...options.body,
    },
    messages,
    setMessages,
    makeSystemMessageCallback,
  });

  const visibleMessages = messages.filter(
    (message) =>
      message.role === "user" || message.role === "assistant" || message.role === "function",
  );

  return {
    visibleMessages,
    append,
    reload,
    stop,
    isLoading,
    input,
    setInput,
  };
}

// store `value` in a ref and update
// it whenever it changes.
function useUpdatedRef<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

export function defaultSystemMessage(
  contextString: string,
  additionalInstructions?: string,
): string {
  return (
    `
Please act as an efficient, competent, conscientious, and industrious professional assistant.

Help the user achieve their goals, and you do so in a way that is as efficient as possible, without unnecessary fluff, but also without sacrificing professionalism.
Always be polite and respectful, and prefer brevity over verbosity.

The user has provided you with the following context:
\`\`\`
${contextString}
\`\`\`

They have also provided you with functions you can call to initiate actions on their behalf, or functions you can call to receive more information.

Please assist them as best you can.

You can ask them for clarifying questions if needed, but don't be annoying about it. If you can reasonably 'fill in the blanks' yourself, do so.

If you would like to call a function, call it without saying anything else.
` + (additionalInstructions ? `\n\n${additionalInstructions}` : "")
  );
}
