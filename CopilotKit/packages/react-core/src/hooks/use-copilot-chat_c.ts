/**
 * `useCopilotChat_c` is for building fully custom UI (headless UI) implementations.
 *
 * <Callout type="info">
 * **Requires a free license key** - Sign up for free at https://cloud.copilotkit.ai/
 * to get your license key with generous usage.
 *
 * Available for free to get started and is possible to use with a self-hosted Runtime.
 * </Callout>
 *
 * ## Key Features:
 *
 * - **Fully headless**: Build your own fully custom UI's for your agentic applications.
 * - **Advanced Suggestions**: Direct access to suggestions array with full control
 * - **Interrupt Handling**: Support for advanced interrupt functionality
 * - **MCP Server Support**: Model Context Protocol server configurations
 * - **Chat Controls**: Complete set of chat management functions
 * - **Loading States**: Comprehensive loading state management
 *
 * ## Usage:
 *
 * ### Basic Setup
 *
 * ```tsx
 * import { CopilotKit } from "@copilotkit/react-core";
 * import { useCopilotChat_c } from "@copilotkit/react-core";
 *
 * export function App() {
 *   return (
 *     <CopilotKit publicApiKey="your-free-subscription-key">
 *       <YourComponent />
 *     </CopilotKit>
 *   );
 * }
 *
 * export function YourComponent() {
 *   const { messages, sendMessage, isLoading } = useCopilotChat_c();
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
 * import { useCopilotChat_c, useCopilotChatSuggestions } from "@copilotkit/react-core";
 *
 * export function SuggestionExample() {
 *   const {
 *     suggestions,
 *     setSuggestions,
 *     generateSuggestions,
 *     isLoadingSuggestions
 *   } = useCopilotChat_c();
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
 * const { messages, sendMessage, suggestions, interrupt } = useCopilotChat_c();
 * ```
 */
function useCopilotChat_c(options: UseCopilotChatOptions_c = {}): UseCopilotChatReturn_c {
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
            "You're using useCopilotChat_c, a subscription-only feature, which offers extensive headless chat capabilities. To continue, you'll need to provide a free subscription key.",
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

export { defaultSystemMessage, useCopilotChat_c };
export type { UseCopilotChatOptions_c, UseCopilotChatReturn_c, MCPServerConfig };

const noKeyWarning = () => {
  styledConsole.logCopilotKitPlatformMessage();
};
