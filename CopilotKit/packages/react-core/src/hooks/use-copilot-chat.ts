import { useMemo, useContext } from "react";
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

  const systemMessage: Message = useMemo(() => {
    const systemMessageMaker = makeSystemMessage || defaultSystemMessage;
    const contextString = getContextString([], defaultCopilotContextCategories); // TODO: make the context categories configurable

    return {
      id: "system",
      content: systemMessageMaker(contextString, additionalInstructions),
      role: "system",
    };
  }, [getContextString, makeSystemMessage, additionalInstructions]);

  const functionDescriptions: ToolDefinition[] = useMemo(() => {
    return getChatCompletionFunctionDescriptions();
  }, [getChatCompletionFunctionDescriptions]);

  const { append, reload, stop, isLoading, input, setInput } = useChat({
    ...options,
    copilotConfig: copilotApiConfig,
    id: options.id,
    initialMessages: [systemMessage].concat(options.initialMessages || []),
    tools: functionDescriptions,
    onFunctionCall: getFunctionCallHandler(),
    headers: { ...options.headers },
    body: {
      ...options.body,
    },
    messages,
    setMessages,
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
