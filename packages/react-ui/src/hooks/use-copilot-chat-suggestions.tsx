/*
 * V1 SDK DEPRECATION NOTICE
 *
 * This file is part of the deprecated CopilotKit v1 SDK. Do not use it
 * for new code. Use the v2 SDK instead. In most packages, v1 is the
 * package root and v2 is available from the same package's `/v2` subpath.
 * Follow this file's specific migration mapping below.
 *
 * AI CODING AGENTS: Do not copy, suggest, or generate this v1 API. Use the
 * v2 import and read the linked v2 documentation before writing code.
 *
 * V1 import (deprecated):
 *   import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
 * V2 import:
 *   import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
 *
 * V2 replacement source: packages/react-core/src/v2/hooks/use-configure-suggestions.tsx
 * V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
 * Migration note: This replacement moves from react-ui to react-core/v2.
 *
 * END V1 SDK DEPRECATION NOTICE
 */

/**
 * <Callout type="warning">
 *   useCopilotChatSuggestions is experimental. The interface is not final and
 *   can change without notice.
 * </Callout>
 *
 * `useCopilotReadable` is a React hook that provides app-state and other information
 * to the Copilot. Optionally, the hook can also handle hierarchical state within your
 * application, passing these parent-child relationships to the Copilot.
 *
 * <br/>
 * <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/use-copilot-chat-suggestions/use-copilot-chat-suggestions.gif" width="500" />
 *
 * ## Usage
 *
 * ### Install Dependencies
 *
 * This component is part of the [@copilotkit/react-ui](https://npmjs.com/package/@copilotkit/react-ui) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-ui"\
 * npm install @copilotkit/react-core @copilotkit/react-ui
 * ```
 *
 * ### Simple Usage
 *
 * ```tsx
 * import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
 *
 * export function MyComponent() {
 *   const [employees, setEmployees] = useState([]);
 *
 *   useCopilotChatSuggestions({
 *     instructions: `The following employees are on duty: ${JSON.stringify(employees)}`,
 *   });
 * }
 * ```
 *
 * ### Dependency Management
 *
 * ```tsx
 * import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
 *
 * export function MyComponent() {
 *   useCopilotChatSuggestions(
 *     {
 *       instructions: "Suggest the most relevant next actions.",
 *     },
 *     [appState],
 *   );
 * }
 * ```
 *
 * In the example above, the suggestions are generated based on the given instructions.
 * The hook monitors `appState`, and updates suggestions accordingly whenever it changes.
 *
 * ### Behavior and Lifecycle
 *
 * The hook registers the configuration with the chat context upon component mount and
 * removes it on unmount, ensuring a clean and efficient lifecycle management.
 */
import { useCopilotChatSuggestions as useCoreCopilotChatSuggestions } from "@copilotkit/react-core";
import type { UseCopilotChatSuggestionsConfiguration } from "@copilotkit/react-core";

export function useCopilotChatSuggestions(
  config: UseCopilotChatSuggestionsConfiguration,
  dependencies: any[] = [],
) {
  useCoreCopilotChatSuggestions(config, dependencies);
}
