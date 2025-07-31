/**
 * `useCopilotChat` is a React hook that lets you directly interact with the
 * Copilot instance. Use to implement a fully custom UI (headless UI) or to
 * programmatically interact with the Copilot instance managed by the default
 * UI.
 *
 * **Requires a publicApiKey** - Sign up for free at https://cloud.copilotkit.ai/
 * to get your API key with generous usage limits.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * ```tsx
 * import { CopilotKit } from "@copilotkit/react-core";
 * import { useCopilotChat } from "@copilotkit/react-core";
 * import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
 *
 * export function App() {
 *   return (
 *     <CopilotKit publicApiKey="your-public-api-key">
 *       <YourComponent />
 *     </CopilotKit>
 *   );
 * }
 *
 * export function YourComponent() {
 *   const { appendMessage } = useCopilotChat();
 *
 *   appendMessage(
 *     new TextMessage({
 *       content: "Hello World",
 *       role: Role.User,
 *     }),
 *   );
 *
 *   // optionally, you can append a message without running chat completion
 *   appendMessage(yourMessage, { followUp: false });
 * }
 * ```
 *
 * ### Working with Suggestions
 *
 * ```tsx
 * import { CopilotKit } from "@copilotkit/react-core";
 * import { useCopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-core";
 *
 * export function App() {
 *   return (
 *     <CopilotKit publicApiKey="your-public-api-key">
 *       <YourComponent />
 *     </CopilotKit>
 *   );
 * }
 *
 * export function YourComponent() {
 *   const {
 *     suggestions,
 *     setSuggestions,
 *     generateSuggestions,
 *     isLoadingSuggestions
 *   } = useCopilotChat();
 *
 *   // Configure AI suggestion generation
 *   useCopilotChatSuggestions({
 *     instructions: "Suggest helpful actions based on the current context",
 *     maxSuggestions: 3
 *   });
 *
 *   // Manual suggestion control
 *   const handleCustomSuggestion = () => {
 *     setSuggestions([{ title: "Custom Action", message: "Perform custom action" }]);
 *   };
 *
 *   // Trigger AI generation
 *   const handleGenerateSuggestions = async () => {
 *     await generateSuggestions();
 *   };
 * }
 * ```
 *
 * `useCopilotChat` returns an object with the following properties:
 *
 * ```tsx
 * const {
 *   visibleMessages, // An array of messages that are currently visible in the chat.
 *   appendMessage, // A function to append a message to the chat.
 *   setMessages, // A function to set the messages in the chat.
 *   deleteMessage, // A function to delete a message from the chat.
 *   reloadMessages, // A function to reload the messages from the API.
 *   stopGeneration, // A function to stop the generation of the next message.
 *   reset, // A function to reset the chat.
 *   isLoading, // A boolean indicating if the chat is loading.
 *
 *   // Suggestion control (headless UI)
 *   suggestions, // Current suggestions array
 *   setSuggestions, // Manually set suggestions
 *   generateSuggestions, // Trigger AI suggestion generation
 *   resetSuggestions, // Clear all suggestions
 *   isLoadingSuggestions, // Whether suggestions are being generated
 * } = useCopilotChat();
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
            "You're using useCopilotChat_c, which offers improved headless chat capabilities. Get your free API key to continue (always free for open-source, no card required)",
          code: CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR,
          severity: Severity.CRITICAL,
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
