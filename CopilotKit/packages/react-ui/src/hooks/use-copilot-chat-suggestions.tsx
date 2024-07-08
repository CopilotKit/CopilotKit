/**
 * A hook for providing suggestions to the user in the Copilot chat.
 *
 * <Warning>
 *   useCopilotChatSuggestions is experimental. The interface is not final and
 *   can change without further notice.
 * </Warning>
 *
 * <img src="/images/useCopilotChatSuggestions/use-copilot-chat-suggestions.gif" width="500" />
 *
 * <img referrerPolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be" />
 *
 * `useCopilotChatSuggestions` integrates auto-generated chat suggestions into your application in the context of your
 * app's state. It dynamically manages suggestions based on provided configurations and
 * dependencies.
 *
 * <RequestExample>
 *   ```jsx useCopilotChatSuggestions Example
 *   import { useCopilotChatSuggestions }
 *     from "@copilotkit/react-ui";
 *
 *   useCopilotChatSuggestions({
 *     instructions: "Your instructions for suggestions.",
 *   })
 *   ```
 * </RequestExample>
 *
 * ## Basic Setup
 *
 * To incorporate this hook into your React components, start by importing it:
 *
 * ```tsx
 * import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
 * ```
 *
 * Then, use it in your component to initiate suggestion functionality:
 *
 * ```tsx
 * useCopilotChatSuggestions({
 *   instructions: "Your instructions for suggestions.",
 * });
 * ```
 *
 * ## Dependency Management
 *
 * ```tsx
 * import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
 *
 * useCopilotChatSuggestions(
 *   {
 *     instructions: "Suggest the most relevant next actions.",
 *   },
 *   [appState],
 * );
 * ```
 *
 * In the example above, the suggestions are generated based on the given instructions.
 * The hook monitors `appState`, and updates suggestions accordingly whenever it changes.
 *
 * ## Behavior and Lifecycle
 *
 * The hook registers the configuration with the chat context upon component mount and
 * removes it on unmount, ensuring a clean and efficient lifecycle management.
 */

import { useEffect } from "react";
import { useCopilotContext } from "@copilotkit/react-core";
import { randomId } from "@copilotkit/shared";

interface UseCopilotChatSuggestionsConfiguration {
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
   * An optional class name to apply to the suggestions.
   */
  className?: string;
}

export function useCopilotChatSuggestions(
  {
    instructions,
    className,
    minSuggestions = 1,
    maxSuggestions = 3,
  }: UseCopilotChatSuggestionsConfiguration,
  dependencies: any[] = [],
) {
  const context = useCopilotContext();

  useEffect(() => {
    const id = randomId();

    context.addChatSuggestionConfiguration(id, {
      instructions,
      minSuggestions,
      maxSuggestions,
      className,
    });

    return () => {
      context.removeChatSuggestionConfiguration(id);
    };
  }, dependencies);
}
