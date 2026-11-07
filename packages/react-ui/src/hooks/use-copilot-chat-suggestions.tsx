/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — useCopilotChatSuggestions:
 *   V2 import and usage:
 *     import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
 *
 *     function Suggestions() {
 *       useConfigureSuggestions({
 *         suggestions: [
 *           { title: "Help", message: "Help me get started" },
 *         ],
 *       });
 *       return null;
 *     }
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-configure-suggestions.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
 *   Migration note: This replacement moves from react-ui to react-core/v2.
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * <Callout type="info">
 *   In v2, use [`useConfigureSuggestions`](/reference/v2/hooks/useConfigureSuggestions) from `@copilotkit/react-core/v2`.
 * </Callout>
 *
 * `useCopilotChatSuggestions` generates suggestions in the chat from your instructions
 * and app state.
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
 * removes it on unmount.
 *
 * ## Parameters
 *
 * Pass either the instructions to generate suggestions, or a static list of suggestions.
 *
 * <PropertyReference name="instructions" type="string" required>
 * The prompt for the suggestions.
 * </PropertyReference>
 *
 * <PropertyReference name="minSuggestions" type="number" default="1">
 * The minimum number of suggestions to generate.
 * </PropertyReference>
 *
 * <PropertyReference name="maxSuggestions" type="number" default="3">
 * The maximum number of suggestions to generate.
 * </PropertyReference>
 *
 * <PropertyReference name="available" type="'enabled' | 'disabled' | 'always' | 'before-first-message' | 'after-first-message'" default="'before-first-message'">
 * When the chat shows the suggestions. `'enabled'` means `'always'`.
 * </PropertyReference>
 *
 * <PropertyReference name="className" type="string">
 * A class name to apply to the suggestions.
 * </PropertyReference>
 *
 * <PropertyReference name="suggestions" type="{ title: string; message: string }[]">
 * The static form: a list of suggestions that the chat shows without generating them.
 * </PropertyReference>
 *
 * <PropertyReference name="dependencies" type="any[]">
 * The second argument. Values that configure the suggestions again when they change.
 * </PropertyReference>
 */
import { useCopilotChatSuggestions as useCoreCopilotChatSuggestions } from "@copilotkit/react-core";
import type { UseCopilotChatSuggestionsConfiguration } from "@copilotkit/react-core";

/**
 * @deprecated The v1 SDK is deprecated. Use v2 instead. Use `useConfigureSuggestions` from `@copilotkit/react-core/v2` instead.
 *
 * ```tsx
 * import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
 *
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
 */
export function useCopilotChatSuggestions(
  config: UseCopilotChatSuggestionsConfiguration,
  dependencies: any[] = [],
) {
  useCoreCopilotChatSuggestions(config, dependencies);
}
