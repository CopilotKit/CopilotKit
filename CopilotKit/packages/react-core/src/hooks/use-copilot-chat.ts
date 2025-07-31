/**
 * `useCopilotChat` is a lightweight React hook for headless chat interactions.
 * Perfect for programmatic messaging, background operations, and custom UI implementations.
 *
 * **Open Source Friendly** - Works without requiring a `publicApiKey`.
 *
 * ## Use Cases:
 *
 * - **Programmatic Messaging**: Send messages without displaying chat UI
 * - **Background Operations**: Trigger AI interactions in the background
 * - **Custom UI**: Build your own chat interface using CopilotKit's messaging infrastructure
 * - **Testing & Automation**: Programmatic chat interactions for testing
 * - **Fire-and-Forget**: Send messages without needing to read responses
 * - **Suggestion Management**: Control chat suggestions programmatically
 *
 * ## What's Included:
 *
 * - `sendMessage` - Send messages to the chat (preferred over `appendMessage`)
 * - `appendMessage` - Legacy method for sending messages (deprecated)
 * - `setSuggestions` - Manually control suggestions
 * - `generateSuggestions` - Trigger AI-powered suggestion generation
 *
 * ## What's NOT Included:
 *
 * - Message reading (`visibleMessages`)
 * - Loading states (`isLoading`, `isLoadingSuggestions`)
 * - Message management (`setMessages`, `deleteMessage`, `reloadMessages`)
 * - Chat controls (`reset`, `stopGeneration`)
 * - Advanced features (`mcpServers`, `runChatCompletion`, `interrupt`)
 *
 * ## Usage:
 *
 * ### Basic Messaging
 *
 * ```tsx
 * import { useCopilotChat } from "@copilotkit/react-core";
 *
 * export function BackgroundMessaging() {
 *   const { sendMessage } = useCopilotChat();
 *
 *   const sendMessage = async () => {
 *     await sendMessage({
 *       id: "123",
 *       role: "user",
 *       content: "Process this data in the background",
 *     });
 *   };
 *
 *   return <button onClick={sendMessage}>Send Message</button>;
 * }
 * ```
 *
 * ### Suggestion Management
 *
 * ```tsx
 * import { useCopilotChat } from "@copilotkit/react-core";
 *
 * export function SuggestionController() {
 *   const { setSuggestions, generateSuggestions } = useCopilotChat();
 *
 *   const setCustomSuggestions = () => {
 *     setSuggestions([
 *       { title: "Analyze Data", message: "Analyze the current dataset" },
 *       { title: "Generate Report", message: "Create a summary report" }
 *     ]);
 *   };
 *
 *   const triggerAISuggestions = async () => {
 *     await generateSuggestions();
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={setCustomSuggestions}>Set Custom Suggestions</button>
 *       <button onClick={triggerAISuggestions}>Generate AI Suggestions</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * ### Manual Suggestions
 *
 * ```tsx
 * import { useCopilotChat } from "@copilotkit/react-core";
 *
 * export function AutomatedWorkflow() {
 *   const { setSuggestions } = useCopilotChat();
 *
 *   const manuallySetSuggestions = () => {
 *     setSuggestions([
 *       { title: "Continue", message: "Continue to next step" },
 *       { title: "Stop", message: "Stop the workflow" }
 *     ]);
 *   };
 *
 *   return <button onClick={manuallySetSuggestions}>Manually Set Suggestions</button>;
 * }
 * ```
 *
 * ### With Configuration Options
 *
 * ```tsx
 * import { useCopilotChat } from "@copilotkit/react-core";
 *
 * export function ConfiguredChat() {
 *   const { sendMessage } = useCopilotChat({
 *     headers: { "X-Custom-Header": "value" },
 *     makeSystemMessage: (context, instructions) => 
 *       `You are a helpful assistant. ${instructions || ""}`
 *   });
 *
 *   return <button onClick={() => sendMessage(message)}>Send Message</button>;
 * }
 * ```
 *
 * ## Return Type:
 *
 * ```tsx
 * const {
 *   sendMessage,        // Send messages programmatically (preferred)
 *   appendMessage,      // Legacy method (deprecated)
 *   setSuggestions,     // Set custom suggestions array
 *   generateSuggestions, // Trigger AI suggestion generation
 * } = useCopilotChat();
 * ```
 */

import { 
  UseCopilotChatOptions, 
  useCopilotChat as useCopilotChatInternal, 
  UseCopilotChatReturn as UseCopilotChatReturnInternal,
} from "./use-copilot-chat_internal";

// Create a type that excludes message-related properties from the internal type
export type UseCopilotChatReturn = Omit<UseCopilotChatReturnInternal, 
  | 'messages' 
  | 'sendMessage'
  | 'suggestions'
  | 'interrupt'
>;



/**
 * A lightweight React hook for headless chat interactions.
 * Perfect for programmatic messaging, background operations, and custom UI implementations.
 *
 * **Open Source Friendly** - Works without requiring a `publicApiKey`.
 *
 * @param options - Configuration options for the chat
 * @returns Object containing appendMessage, setSuggestions, and generateSuggestions functions
 *
 * @example
 * ```tsx
 * const { appendMessage, setSuggestions, generateSuggestions } = useCopilotChat();
 * ```
 */
export function useCopilotChat(
  options: UseCopilotChatOptions = {},
): UseCopilotChatReturn {
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
