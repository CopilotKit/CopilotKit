/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useCopilotChatHeadless_c:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * <Callout type="info">
 *   `useCopilotChatHeadless_c` has no direct v2 replacement. In v2, build headless UI on [`useAgent`](/reference/v2/hooks/useAgent). See [Headless UI](/custom-look-and-feel/headless-ui).
 * </Callout>
 *
 * `useCopilotChatHeadless_c` is for building fully custom UI (headless UI) implementations.
 *
 * <Callout title="This is a CopilotKit Intelligence feature">
 * Read more about <a href="/intelligence/overview">CopilotKit Intelligence</a>.
 *
 * Usage is generous and **free** to get started.
 *
 * The hook needs a public license key. Without one, it returns no-op functions.
 * </Callout>
 *
 * ## Key Features
 *
 * - **Fully headless**: Build your own fully custom UI's for your agentic applications.
 * - **Advanced Suggestions**: Direct access to suggestions array with full control
 * - **Interrupt Handling**: Interrupt content for human-in-the-loop workflows
 * - **MCP Server Support**: Model Context Protocol server configurations
 *
 *
 * ## Usage
 *
 * ### Basic Setup
 *
 * ```tsx
 * import { CopilotKit } from "@copilotkit/react-core";
 * import { useCopilotChatHeadless_c } from "@copilotkit/react-core";
 *
 * export function App() {
 *   return (
 *     <CopilotKit runtimeUrl="/api/copilotkit" publicLicenseKey="YOUR_PUBLIC_LICENSE_KEY">
 *       <YourComponent />
 *     </CopilotKit>
 *   );
 * }
 *
 * export function YourComponent() {
 *   const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c();
 *
 *   const handleSendMessage = async () => {
 *     await sendMessage({
 *       id: "123",
 *       role: "user",
 *       content: "Hello World",
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <div key={msg.id}>{msg.content}</div>)}
 *       <button onClick={handleSendMessage} disabled={isLoading}>
 *         Send Message
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * ### Working with Suggestions
 *
 * ```tsx
 * import { useCopilotChatHeadless_c, useCopilotChatSuggestions } from "@copilotkit/react-core";
 *
 * export function SuggestionExample() {
 *   const {
 *     suggestions,
 *     setSuggestions,
 *     generateSuggestions,
 *     isLoadingSuggestions
 *   } = useCopilotChatHeadless_c();
 *
 *   // Configure AI suggestion generation
 *   useCopilotChatSuggestions({
 *     instructions: "Suggest helpful actions based on the current context",
 *     maxSuggestions: 3
 *   });
 *
 *   return (
 *     <div>
 *       {suggestions.map(suggestion => (
 *         <button key={suggestion.title}>{suggestion.title}</button>
 *       ))}
 *       <button onClick={generateSuggestions} disabled={isLoadingSuggestions}>
 *         Generate Suggestions
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * ## Return Values
 * The following properties are returned from the hook:
 *
 * <PropertyReference name="messages" type="Message[]">
 * The messages currently in the chat in AG-UI format
 * </PropertyReference>
 *
 * <PropertyReference name="sendMessage" type="(message: Message, options?) => Promise<void>">
 * Send a new message to the chat and trigger AI response
 * </PropertyReference>
 *
 * <PropertyReference name="setMessages" type="(messages: Message[] | DeprecatedGqlMessage[]) => void">
 * Replace all messages in the chat with new array
 * </PropertyReference>
 *
 * <PropertyReference name="deleteMessage" type="(messageId: string) => void">
 * Remove a specific message by ID from the chat
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
 *
 * <PropertyReference name="suggestions" type="Suggestion[]">
 * Current suggestions array for reading or manual control
 * </PropertyReference>
 *
 * <PropertyReference name="setSuggestions" type="(suggestions: Omit<Suggestion, 'isLoading'>[]) => void">
 * Manually set suggestions for custom workflows
 * </PropertyReference>
 *
 * <PropertyReference name="generateSuggestions" type="() => Promise<void>">
 * Trigger AI-powered suggestion generation using configured settings
 * </PropertyReference>
 *
 * <PropertyReference name="resetSuggestions" type="() => void">
 * Clear all current suggestions and reset generation state
 * </PropertyReference>
 *
 * <PropertyReference name="isLoadingSuggestions" type="boolean">
 * Whether suggestions are currently being generated
 * </PropertyReference>
 *
 * <PropertyReference name="interrupt" type="string | React.ReactElement | null">
 * Interrupt content for human-in-the-loop workflows
 * </PropertyReference>
 *
 * <PropertyReference name="isAvailable" type="boolean">
 * Whether the chat agent is available to generate responses.
 * </PropertyReference>
 *
 * <PropertyReference name="agent" type="AbstractAgent | undefined">
 * The agent that the chat runs.
 * </PropertyReference>
 *
 * <PropertyReference name="threadId" type="string | undefined">
 * The id of the current thread.
 * </PropertyReference>
 *
 * ## Parameters
 *
 * <PropertyReference name="suggestions" type="'auto' | 'manual' | Omit<Suggestion, 'isLoading'>[]">
 * How the chat gets suggestions: `"auto"` generates them, `"manual"` leaves them to your
 * code, and a static list shows the same suggestions every time.
 * </PropertyReference>
 *
 * <PropertyReference name="onInProgress" type="(isLoading: boolean) => void">
 * Called with whether the agent is running.
 * </PropertyReference>
 *
 * <PropertyReference name="onSubmitMessage" type="(messageContent: string) => Promise<void> | void">
 * Called with the message text before the hook sends it.
 * </PropertyReference>
 *
 * <PropertyReference name="onStopGeneration" type="OnStopGeneration">
 * Called when the user stops the run.
 * </PropertyReference>
 *
 * <PropertyReference name="onReloadMessages" type="OnReloadMessages">
 * Called when the user reloads a message.
 * </PropertyReference>
 */
import { useEffect } from "react";
import { useCopilotContext } from "../context/copilot-context";
import type {
  UseCopilotChatOptions as UseCopilotChatOptions_c,
  UseCopilotChatReturn as UseCopilotChatReturn_c,
  MCPServerConfig,
} from "./use-copilot-chat_internal";
import {
  useCopilotChatInternal,
  defaultSystemMessage,
} from "./use-copilot-chat_internal";

import {
  ErrorVisibility,
  Severity,
  CopilotKitError,
  CopilotKitErrorCode,
  styledConsole,
} from "@copilotkit/shared";

// Non-functional fallback implementation
const createNonFunctionalReturn = (): UseCopilotChatReturn_c => ({
  visibleMessages: [],
  messages: [],
  sendMessage: async () => {},
  appendMessage: async () => {},
  setMessages: () => {},
  deleteMessage: () => {},
  reloadMessages: async () => {},
  stopGeneration: () => {},
  reset: () => {},
  isLoading: false,
  isAvailable: false,
  runChatCompletion: async () => [],
  mcpServers: [],
  setMcpServers: () => {},
  suggestions: [],
  setSuggestions: () => {},
  generateSuggestions: async () => {},
  resetSuggestions: () => {},
  isLoadingSuggestions: false,
  interrupt: null,
});
/**
 * CopilotKit Intelligence React hook that provides complete chat functionality for fully custom UI implementations.
 * Includes all advanced features like direct message access, suggestions array, interrupt handling, and MCP support.
 *
 * @param options - Configuration options for the chat
 * @returns Complete chat interface with all CopilotKit Intelligence features
 *
 * @example
 * ```tsx
 * const { messages, sendMessage, suggestions, interrupt } = useCopilotChatHeadless_c();
 * ```
 */
function useCopilotChatHeadless_c(
  options: UseCopilotChatOptions_c = {},
): UseCopilotChatReturn_c {
  const { copilotApiConfig, setBannerError } = useCopilotContext();

  // Check if publicApiKey is available
  const hasPublicApiKey = Boolean(copilotApiConfig.publicApiKey);

  // Always call the internal hook (follows rules of hooks)
  const internalResult = useCopilotChatInternal(options);

  // Set banner error when no public API key is provided
  useEffect(() => {
    if (!hasPublicApiKey) {
      setBannerError(
        new CopilotKitError({
          message:
            // add link to documentation here
            "You're using useCopilotChatHeadless_c, a CopilotKit Intelligence feature that offers extensive headless chat capabilities. To continue, you'll need to provide a free public license key.",
          code: CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR,
          severity: Severity.WARNING,
          visibility: ErrorVisibility.BANNER,
        }),
      );
      styledConsole.logCopilotKitPlatformMessage();
    } else {
      setBannerError(null); // Clear banner when API key is provided
    }
  }, [hasPublicApiKey]); // Removed setBannerError dependency

  // Return internal result if publicApiKey is available, otherwise return fallback
  if (hasPublicApiKey) {
    return internalResult;
  }

  // Return non-functional fallback when no publicApiKey
  return createNonFunctionalReturn();
}

export { defaultSystemMessage, useCopilotChatHeadless_c };
export type {
  UseCopilotChatOptions_c,
  UseCopilotChatReturn_c,
  MCPServerConfig,
};

const noKeyWarning = () => {
  styledConsole.logCopilotKitPlatformMessage();
};
