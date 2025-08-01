/**
 * `useCopilotChat` is a lightweight React hook for headless chat interactions.
 * Perfect for programmatic messaging, background operations, and custom UI implementations.
 *
 * **Open Source Friendly** - Works without requiring a free subscription key.
 *
 * ## Use Cases:
 *
 * - **Programmatic Messaging**: Send messages without displaying chat UI
 * - **Programmatic control**: Control prebuilt component programmatically
 * - **Background Operations**: Trigger AI interactions in the background
 * - **Fire-and-Forget**: Send messages without needing to read responses
 */

import {
  UseCopilotChatOptions,
  useCopilotChat as useCopilotChatInternal,
  UseCopilotChatReturn as UseCopilotChatReturnInternal,
} from "./use-copilot-chat_internal";

// Create a type that excludes message-related properties from the internal type
export type UseCopilotChatReturn = Omit<
  UseCopilotChatReturnInternal,
  "messages" | "sendMessage" | "suggestions" | "interrupt"
>;

/**
 * A lightweight React hook for headless chat interactions.
 * Perfect for programmatic messaging, background operations, and custom UI implementations.
 *
 * **Open Source Friendly** - Works without requiring a `publicApiKey`.
 *
 * @param options - Configuration options for the chat
 * @returns Object containing chat management functions (excludes: messages, sendMessage, suggestions, interrupt)
 *
 * @example
 * ```tsx
 * const { visibleMessages, appendMessage, setSuggestions, generateSuggestions, reset } = useCopilotChat();
 * ```
 */
export function useCopilotChat(options: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  // Use the internal implementation (no API key required)
  const {
    visibleMessages,
    appendMessage,
    setSuggestions,
    generateSuggestions,
    setMessages,
    deleteMessage,
    reloadMessages,
    stopGeneration,
    reset,
    isLoading,
    runChatCompletion,
    mcpServers,
    setMcpServers,
    resetSuggestions,
    isLoadingSuggestions,
  } = useCopilotChatInternal(options);

  return {
    visibleMessages,
    appendMessage,
    setMessages,
    deleteMessage,
    reloadMessages,
    stopGeneration,
    reset,
    isLoading,
    runChatCompletion,
    setSuggestions,
    generateSuggestions,
    mcpServers,
    setMcpServers,
    resetSuggestions,
    isLoadingSuggestions,
  };
}
