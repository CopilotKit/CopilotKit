/**
 * `useCopilotChatHeadless_c` is for building fully custom UI (headless UI) implementations.
 *
 * <Callout title="This is a premium-only feature">
 * Sign up for free on [Copilot Cloud](https://cloud.copilotkit.ai) to get your public license key or read more about <a href="/premium/overview">premium features</a>.
 *
 * Usage is generous, **free** to get started, and works with **either self-hosted or Copilot Cloud** environments.
 * </Callout>
 *
 * ## Key Features
 *
 * - **Fully headless**: Build your own fully custom UI's for your agentic applications.
 * - **Advanced Suggestions**: Direct access to suggestions array with full control
 * - **Interrupt Handling**: Support for advanced interrupt functionality
 * - **MCP Server Support**: Model Context Protocol server configurations
 * - **Chat Controls**: Complete set of chat management functions
 * - **Loading States**: Comprehensive loading state management
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
 *     <CopilotKit publicApiKey="your-free-public-license-key">
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
 * <PropertyReference name="suggestions" type="SuggestionItem[]">
 * Current suggestions array for reading or manual control
 * </PropertyReference>
 *
 * <PropertyReference name="setSuggestions" type="(suggestions: SuggestionItem[]) => void">
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
 */
import { useEffect } from "react";
import { useCopilotContext } from "../context/copilot-context";
import {
  useCopilotChat as useCopilotChatInternal,
  defaultSystemMessage,
  UseCopilotChatOptions as UseCopilotChatOptions_c,
  UseCopilotChatReturn as UseCopilotChatReturn_c,
  MCPServerConfig,
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
 * Enterprise React hook that provides complete chat functionality for fully custom UI implementations.
 * Includes all advanced features like direct message access, suggestions array, interrupt handling, and MCP support.
 *
 * **Requires a publicApiKey** - Sign up for free at https://cloud.copilotkit.ai/
 *
 * @param options - Configuration options for the chat
 * @returns Complete chat interface with all enterprise features
 *
 * @example
 * ```tsx
 * const { messages, sendMessage, suggestions, interrupt } = useCopilotChatHeadless_c();
 * ```
 */
function useCopilotChatHeadless_c(options: UseCopilotChatOptions_c = {}): UseCopilotChatReturn_c {
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
            "You're using useCopilotChatHeadless_c, a premium-only feature, which offers extensive headless chat capabilities. To continue, you'll need to provide a free public license key.",
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
export type { UseCopilotChatOptions_c, UseCopilotChatReturn_c, MCPServerConfig };

const noKeyWarning = () => {
  styledConsole.logCopilotKitPlatformMessage();
};
