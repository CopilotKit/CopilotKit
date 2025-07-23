/**
 * `useCopilotChatLight` is a lightweight React hook for headless chat interactions.
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
 * - `appendMessage` - Send messages to the chat
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
 * import { useCopilotChatLite } from "@copilotkit/react-core";
 * import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
 *
 * export function BackgroundMessaging() {
 *   const { appendMessage } = useCopilotChatLite();
 *
 *   const sendBackgroundMessage = async () => {
 *     await appendMessage(new TextMessage({
 *       content: "Process this data in the background",
 *       role: Role.User,
 *     }));
 *   };
 *
 *   return <button onClick={sendBackgroundMessage}>Process Data</button>;
 * }
 * ```
 *
 * ### Suggestion Management
 *
 * ```tsx
 * import { useCopilotChatLight } from "@copilotkit/react-core";
 *
 * export function SuggestionController() {
 *   const { setSuggestions, generateSuggestions } = useCopilotChatLight();
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
 * ### Automated Workflows
 *
 * ```tsx
 * import { useCopilotChatLight } from "@copilotkit/react-core";
 *
 * export function AutomatedWorkflow() {
 *   const { appendMessage, setSuggestions } = useCopilotChatLight();
 *
 *   const runWorkflow = async () => {
 *     // Step 1: Send initial message
 *     await appendMessage(new TextMessage({
 *       content: "Start workflow analysis",
 *       role: Role.User,
 *     }));
 *
 *     // Step 2: Set contextual suggestions
 *     setSuggestions([
 *       { title: "Continue", message: "Continue to next step" },
 *       { title: "Stop", message: "Stop the workflow" }
 *     ]);
 *   };
 *
 *   return <button onClick={runWorkflow}>Run Automated Workflow</button>;
 * }
 * ```
 *
 * ## Return Type:
 *
 * ```tsx
 * const {
 *   appendMessage,    // Send messages programmatically
 *   setSuggestions,   // Set custom suggestions array
 *   generateSuggestions, // Trigger AI suggestion generation
 * } = useCopilotChatLight();
 * ```
 */

import { Message } from "@copilotkit/shared";
import { AppendMessageOptions } from "./use-chat";
import { useCopilotChat as useCopilotChatInternal } from "./use-copilot-chat_internal";
import type { SuggestionItem } from "../utils";

export interface UseCopilotChatLightOptions {
  /**
   * A unique identifier for the chat. If not provided, a random one will be
   * generated. When provided, the chat instance with the same `id` will
   * have shared state across components.
   */
  id?: string;

  /**
   * HTTP headers to be sent with the API request.
   */
  headers?: Record<string, string> | Headers;

  /**
   * Initial messages to populate the chat with.
   */
  initialMessages?: Message[];

  /**
   * A function to generate the system message. Defaults to `defaultSystemMessage`.
   */
  makeSystemMessage?: (contextString: string, additionalInstructions?: string) => string;
}

export interface UseCopilotChatLightReturn {
  /**
   * Send a new message to the chat programmatically.
   *
   * @param message - The message to send
   * @param options - Optional configuration for the message
   *
   * @example
   * ```tsx
   * await appendMessage(new TextMessage({
   *   content: "Hello, process this request",
   *   role: Role.User,
   * }));
   * ```
   */
  appendMessage: (message: Message, options?: AppendMessageOptions) => Promise<void>;

  /**
   * Manually set the suggestions array.
   * Useful for custom suggestion workflows and manual control.
   *
   * @param suggestions - Array of suggestion items to display
   *
   * @example
   * ```tsx
   * setSuggestions([
   *   { title: "Continue", message: "Continue the process" },
   *   { title: "Stop", message: "Stop the current operation" }
   * ]);
   * ```
   */
  setSuggestions: (suggestions: SuggestionItem[]) => void;

  /**
   * Trigger AI-powered suggestion generation.
   * Uses configurations from `useCopilotChatSuggestions` hooks.
   * Respects global debouncing - only one generation can run at a time.
   *
   * @returns Promise that resolves when suggestions are generated
   *
   * @example
   * ```tsx
   * await generateSuggestions();
   * ```
   */
  generateSuggestions: () => Promise<void>;
}

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
 * const { appendMessage, setSuggestions, generateSuggestions } = useCopilotChatLite();
 * ```
 */
export function useCopilotChatLight(
  options: UseCopilotChatLightOptions = {},
): UseCopilotChatLightReturn {
  // Use the internal implementation (no API key required)
  const { appendMessage, setSuggestions, generateSuggestions } = useCopilotChatInternal(options);

  return {
    appendMessage,
    setSuggestions,
    generateSuggestions,
  };
}
