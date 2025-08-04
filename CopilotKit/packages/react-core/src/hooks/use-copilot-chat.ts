/**
 * `useCopilotChat` is a lightweight React hook for headless chat interactions.
 * Perfect for controlling the prebuilt chat components programmatically.
 *
 * **Open Source Friendly** - Works without requiring a free public license key.
 *
 * <Callout title="Looking for fully headless UI?">
 * Get started with [useCopilotChatHeadless_c](https://docs.copilotkit.ai/reference/hooks/useCopilotChatHeadless_c).
 * </Callout>
 *
 * ## Use Cases
 *
 * - **Programmatic Messaging**: Send messages without displaying chat UI
 * - **Programmatic control**: Control prebuilt component programmatically
 * - **Background Operations**: Trigger AI interactions in the background
 * - **Fire-and-Forget**: Send messages without needing to read responses
 *
 * ## Usage
 *
 * ```tsx
 * import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
 *
 * const { appendMessage } = useCopilotChat();
 *
 * // Example usage without naming conflicts
 * const handleSendMessage = async (content: string) => {
 *   await appendMessage(
 *     new TextMessage({
 *       role: MessageRole.User,
 *       content,
 *     })
 *   );
 * };
 * ```
 *
 * ## Return Values
 * The following properties are returned from the hook:
 *
 * <PropertyReference name="visibleMessages" type="DeprecatedGqlMessage[]" deprecated>
 * Array of messages in old non-AG-UI format, use for compatibility only
 * </PropertyReference>
 *
 * <PropertyReference name="appendMessage" type="(message: DeprecatedGqlMessage, options?) => Promise<void>" deprecated>
 * Append message using old format, use `sendMessage` instead
 * </PropertyReference>
 *
 * <PropertyReference name="reloadMessages" type="(messageId: string) => Promise<void>">
 * Regenerate the response for a specific message by ID
 * </PropertyReference>
 *
 * <PropertyReference name="stopGeneration" type="() => void">
 * Stop the current message generation process
 * </PropertyReference>
 *
 * <PropertyReference name="reset" type="() => void">
 * Clear all messages and reset chat state completely
 * </PropertyReference>
 *
 * <PropertyReference name="isLoading" type="boolean">
 * Whether the chat is currently generating a response
 * </PropertyReference>
 *
 * <PropertyReference name="runChatCompletion" type="() => Promise<Message[]>">
 * Manually trigger chat completion for advanced usage
 * </PropertyReference>
 *
 * <PropertyReference name="mcpServers" type="MCPServerConfig[]">
 * Array of Model Context Protocol server configurations
 * </PropertyReference>
 *
 * <PropertyReference name="setMcpServers" type="(servers: MCPServerConfig[]) => void">
 * Update MCP server configurations for enhanced context
 * </PropertyReference>
 */

import {
  UseCopilotChatOptions,
  useCopilotChat as useCopilotChatInternal,
  UseCopilotChatReturn as UseCopilotChatReturnInternal,
} from "./use-copilot-chat_internal";

// Create a type that excludes message-related properties from the internal type
export type UseCopilotChatReturn = Omit<
  UseCopilotChatReturnInternal,
  | "messages"
  | "sendMessage"
  | "suggestions"
  | "setSuggestions"
  | "generateSuggestions"
  | "isLoadingSuggestions"
  | "resetSuggestions"
  | "interrupt"
  | "setMessages"
  | "deleteMessage"
>;

/**
 * A lightweight React hook for headless chat interactions.
 * Perfect for programmatic messaging, background operations, and custom UI implementations.
 *
 * **Open Source Friendly** - Works without requiring a `publicApiKey`.
 */
export function useCopilotChat(options: UseCopilotChatOptions = {}): UseCopilotChatReturn {
  const {
    visibleMessages,
    appendMessage,
    reloadMessages,
    stopGeneration,
    reset,
    isLoading,
    runChatCompletion,
    mcpServers,
    setMcpServers,
  } = useCopilotChatInternal(options);

  return {
    visibleMessages,
    appendMessage,
    reloadMessages,
    stopGeneration,
    reset,
    isLoading,
    runChatCompletion,
    mcpServers,
    setMcpServers,
  };
}
