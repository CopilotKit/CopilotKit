/**
 * <Callout type="warning">
 *   useCopilotSuggestions is experimental. The interface is not final and
 *   can change without notice.
 * </Callout>
 *
 * `useCopilotSuggestions` is a React hook that provides auto-suggestions that can be added to any
 * UI component.
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
 * TODO
 * ```
 *
 * ### Dependency Management
 *
 * ```tsx
 * TODO
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

import { useEffect, useState, useRef, useCallback } from "react";
import {
  CopilotContextParams,
  CopilotMessagesContextParams,
  extract,
  useCopilotContext,
  useCopilotMessagesContext,
} from "@copilotkit/react-core";
import { MappedParameterTypes, Parameter, randomId } from "@copilotkit/shared";
import { CopilotRequestType } from "@copilotkit/runtime-client-gql";

export interface UseCopilotSuggestionsConfiguration<T extends Parameter[] = []> {
  /**
   * A prompt or instructions for the GPT to generate suggestions.
   */
  instructions?: string;

  /**
   * The data to pass to the suggestions.
   */
  parameters: T;

  /**
   * The current value of the parameter.
   */
  value?: Partial<MappedParameterTypes<T>>;

  /**
   * Whether the suggestions are enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * The debounce time in milliseconds.
   * @default 1000
   */
  debounceTime?: number;
}
export type SuggestionsResult<T extends Parameter[]> =
  | { suggestions: undefined; isAvailable: false; isLoading: boolean }
  | { suggestions: MappedParameterTypes<T>; isAvailable: true; isLoading: boolean };

export function useCopilotSuggestions<const T extends Parameter[]>(
  {
    instructions,
    parameters,
    value,
    enabled = true,
    debounceTime = 1000,
  }: UseCopilotSuggestionsConfiguration<T>,
  dependencies: any[] = [],
): SuggestionsResult<T> {
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<any>();
  const [suggestions, setSuggestions] = useState<SuggestionsResult<T>>({
    suggestions: undefined,
    isAvailable: false,
    isLoading: false,
  });
  const isFirstRunRef = useRef(true);

  const abortSuggestions = useCallback(() => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = null;
  }, []);

  const generalContext = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();
  const context = { ...generalContext, ...messagesContext };

  useEffect(() => {
    abortSuggestions();
    if (!enabled) {
      setSuggestions({ suggestions: undefined, isAvailable: false, isLoading: false });
      return;
    }

    // if value is the same as the last suggestions, don't reload
    if (JSON.stringify(value) === JSON.stringify(suggestions.suggestions)) {
      return;
    }

    debounceTimerRef.current = setTimeout(
      async () => {
        isFirstRunRef.current = false;
        suggestionsAbortControllerRef.current = new AbortController();
        setSuggestions({ ...suggestions, isLoading: true });
        await reloadSuggestions(
          context,
          instructions,
          parameters,
          value,
          suggestionsAbortControllerRef,
          setSuggestions,
        );
      },
      isFirstRunRef.current === true ? 0 : debounceTime,
    );

    return () => {
      clearTimeout(debounceTimerRef.current);
    };
  }, [
    instructions,
    JSON.stringify(parameters),
    JSON.stringify(value),
    enabled,
    debounceTime,
    ...dependencies,
  ]);

  return suggestions;
}

async function reloadSuggestions(
  context: CopilotContextParams & CopilotMessagesContextParams,
  instructions: string | undefined,
  parameters: Parameter[],
  value: any,
  abortControllerRef: React.MutableRefObject<AbortController | null>,
  setSuggestions: (suggestions: any) => void,
) {
  const abortController = abortControllerRef.current;
  let fullInstructions = `It's your task to generate suggestions based on the application context.`;
  if (instructions) {
    fullInstructions += `\n\nIn addition, follow these specific instructions: ${instructions}`;
  }
  if (value) {
    fullInstructions +=
      `\n\nThe current value of the parameter is: ${JSON.stringify(value)}.` +
      `If it makes sense to complete the existing data, i.e. expand string values, add new elements to arrays, etc., do so. ` +
      `Otherwise, generate a new value.`;
  }

  await extract({
    context,
    instructions: fullInstructions,
    parameters,
    abortSignal: abortController?.signal,
    requestType: CopilotRequestType.Task,
    stream({ args, status }) {
      if (status === "complete") {
        setSuggestions({ suggestions: args, isAvailable: true, isLoading: false });
      }
    },
  });
}
