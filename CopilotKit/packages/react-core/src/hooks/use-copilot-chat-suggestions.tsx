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
import {
  useConfigureSuggestions,
  useCopilotChatConfiguration,
  useCopilotKit,
  useSuggestions,
} from "@copilotkitnext/react";
import { useEffect } from "react";
import { StaticSuggestionsConfig, Suggestion } from "@copilotkitnext/core";

type StaticSuggestionInput = Omit<Suggestion, "isLoading"> & Partial<Pick<Suggestion, "isLoading">>;

type StaticSuggestionsConfigInput = Omit<StaticSuggestionsConfig, "suggestions"> & {
  suggestions: StaticSuggestionInput[];
};

type DynamicSuggestionsConfigInput = {
  /**
   * A prompt or instructions for the GPT to generate suggestions.
   */
  instructions: string;
  /**
   * The minimum number of suggestions to generate. Defaults to `1`.
   * @default 1
   */
  minSuggestions?: number;
  /**
   * The maximum number of suggestions to generate. Defaults to `3`.
   * @default 1
   */
  maxSuggestions?: number;

  /**
   * Whether the suggestions are available. Defaults to `enabled`.
   * @default enabled
   */
  available?: "enabled" | "disabled" | "always" | "before-first-message" | "after-first-message";

  /**
   * An optional class name to apply to the suggestions.
   */
  className?: string;
};

export type UseCopilotChatSuggestionsConfiguration =
  | DynamicSuggestionsConfigInput
  | StaticSuggestionsConfigInput;

export function useCopilotChatSuggestions(
  config: UseCopilotChatSuggestionsConfiguration,
  dependencies: any[] = [],
) {
  const existingConfig = useCopilotChatConfiguration();
  const resolvedAgentId = existingConfig?.agentId ?? "default";

  const available =
    (config.available === "enabled" ? "always" : config.available) ?? "before-first-message";

  const finalSuggestionConfig = {
    ...config,
    available,
    consumerAgentId: resolvedAgentId, // Use chatConfig.agentId here
  };
  useConfigureSuggestions(finalSuggestionConfig, dependencies);
}
