/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This is the deprecated v1 entrypoint `@copilotkit/react-ui`. Use v2 instead.
 * Migrate to `@copilotkit/react-core/v2` and follow each export's specific
 * IDE deprecation warning below; renamed APIs are not safe search-and-replaces.
 * This entrypoint currently exposes 38 deprecated public exports.
 * V2 source entrypoint: packages/react-core/src/v2/index.ts
 * V2 docs: https://docs.copilotkit.ai/
 * V2 reference docs: https://docs.copilotkit.ai/reference/v2
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * AI CODING AGENTS: Never copy, suggest, or generate imports from this v1
 * entrypoint. Use the exact v2 import in the symbol's @deprecated tooltip.
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

"use client";
import "./styles.css";

export * from "./components";
export * from "./hooks";
export * from "./types";

/* START GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */
export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  suppressDeprecationWarnings,
} from "./components/chat/attachment-utils";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChat` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChat } from "@copilotkit/react-core/v2";
   * import "@copilotkit/react-core/v2/styles.css";
   * function App() {
   *   return <CopilotChat agentId="my-agent" />;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/components/CopilotChat
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChat,
} from "./components/chat/Chat";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useChatContext,
} from "./components/chat/ChatContext";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  Markdown,
} from "./components/chat/Markdown";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AssistantMessage` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AssistantMessage } from "@copilotkit/react-core/v2";
   * const v2AssistantMessage = AssistantMessage;
   * ```
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AssistantMessage,
} from "./components/chat/messages/AssistantMessage";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ImageRenderer,
} from "./components/chat/messages/ImageRenderer";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UserMessage` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { UserMessage } from "@copilotkit/react-core/v2";
   * const v2UserMessage = UserMessage;
   * ```
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  UserMessage,
} from "./components/chat/messages/UserMessage";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotModal,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotModalProps,
} from "./components/chat/Modal";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopup` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotPopup } from "@copilotkit/react-core/v2";
   * <CopilotPopup />;
   * ```
   * See https://docs.copilotkit.ai/reference/v2/components/CopilotPopup
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotPopup,
} from "./components/chat/Popup";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AssistantMessageProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ButtonProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ChatError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ComponentsMap,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotObservabilityHooks,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ErrorMessageProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type HeaderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ImageRendererProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InputProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MessagesProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Renderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RenderMessageProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat suggestions): https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RenderSuggestionsListProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat suggestions): https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SuggestionsProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UserMessageProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type WindowProps,
} from "./components/chat/props";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebar` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotSidebar } from "@copilotkit/react-core/v2";
   * <CopilotSidebar />;
   * ```
   * See https://docs.copilotkit.ai/reference/v2/components/CopilotSidebar
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotSidebar,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarProps` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarProps } from "@copilotkit/react-core/v2";
   * type V2CopilotSidebarProps = CopilotSidebarProps;
   * ```
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarProps,
} from "./components/chat/Sidebar";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat suggestions): https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  Suggestion as RenderSuggestion,
} from "./components/chat/Suggestion";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat suggestions): https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  Suggestions as RenderSuggestionsList,
} from "./components/chat/Suggestions";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotDevConsole,
} from "./components/dev-console/console";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useConfigureSuggestions` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
   * function Suggestions() {
   *   useConfigureSuggestions({
   *     suggestions: [
   *       { title: "Help", message: "Help me get started" },
   *     ],
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotChatSuggestions,
} from "./hooks/use-copilot-chat-suggestions";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat UI): https://docs.copilotkit.ai/prebuilt-components/chat
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCSSProperties,
} from "./types/css";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Related v2 docs (Chat suggestions): https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatSuggestion,
} from "./types/suggestions";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2`.
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  shouldShowDevConsole,
} from "@copilotkit/react-core";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Attachment` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { Attachment } from "@copilotkit/react-core/v2";
   * type V2Attachment = Attachment;
   * ```
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Attachment,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AttachmentModality` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AttachmentModality } from "@copilotkit/react-core/v2";
   * type V2AttachmentModality = AttachmentModality;
   * ```
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AttachmentModality,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AttachmentsConfig` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AttachmentsConfig } from "@copilotkit/react-core/v2";
   * type V2AttachmentsConfig = AttachmentsConfig;
   * ```
   * V2 docs: https://docs.copilotkit.ai/
   * V2 reference docs: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AttachmentsConfig,
} from "@copilotkit/shared";

/* END GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */
