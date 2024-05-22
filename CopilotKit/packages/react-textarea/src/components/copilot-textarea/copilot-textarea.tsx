/**
 * A context-aware, auto-completing textarea.
 *
 * <RequestExample>
 * ```jsx CopilotTextarea Example
 * <CopilotTextarea
 *   autosuggestionsConfig={{
 *     textareaPurpose:
 *      "the body of an email message",
 *     chatApiConfigs: {},
 *   }}
 * />
 * ```
 * </RequestExample>
 *
 * `<CopilotTextarea>` is a React component that acts as a drop-in replacement for the standard `<textarea>`,
 *  offering enhanced autocomplete features powered by AI. It is context-aware, integrating seamlessly with the
 * [useCopilotReadable()](./useCopilotReadable) hook to provide intelligent suggestions based on the application context.
 *
 * In addition, it provides a hovering editor window (available by default via `Cmd+k`) that allows the user to
 * suggest changes to the text, for example providing a summary or rephrasing the text.
 *
 * <img src="/images/CopilotTextarea/CopilotTextarea.gif" width="500" />
 *
 * ## Integrating CopilotTextarea
 *
 * Install the CopilotTextarea frontend packagess:
 *
 * <CodeGroup>
 * ```bash npm
 *   npm i @copilotkit/react-core @copilotkit/react-textarea
 * ```
 *
 * ```bash yarn
 *   yarn add @copilotkit/react-core @copilotkit/react-textarea
 * ```
 *
 * ```bash pnpm
 *   pnpm add @copilotkit/react-core @copilotkit/react-textarea
 * ```
 * </CodeGroup>
 *
 * Use the CopilotTextarea component in your React application similarly to a standard `<textarea />`,
 * with additional configurations for AI-powered features.
 *
 * For example:
 *
 * ```tsx
 * import { CopilotTextarea } from "@copilotkit/react-textarea";
 * import { useState } from "react";
 *
 * export function ExampleComponent() {
 *   const [text, setText] = useState("");
 *
 *   return (
 *     <CopilotTextarea
 *       className="custom-textarea-class"
 *       value={text}
 *       onValueChange={(value: string) => setText(value)}
 *       placeholder="Enter your text here..."
 *       autosuggestionsConfig={{
 *         textareaPurpose: "Provide context or purpose of the textarea.",
 *         chatApiConfigs: {
 *           suggestionsApiConfig: {
 *             forwardedParams: {
 *               max_tokens: 20,
 *               stop: [".", "?", "!"],
 *             },
 *           },
 *         },
 *       }}
 *     />
 *   );
 * }
 * ```
 */
import React from "react";
import { useMakeStandardAutosuggestionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-autosuggestions-function";
import { HTMLCopilotTextAreaElement } from "../../types";
import { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import {
  AutosuggestionsConfig,
  defaultAutosuggestionsConfig,
} from "../../types/autosuggestions-config";
import { BaseCopilotTextarea } from "../base-copilot-textarea/base-copilot-textarea";
import { useMakeStandardInsertionOrEditingFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-insertion-function";
import merge from "lodash.merge";
import { AutosuggestionsConfigUserSpecified } from "../../types/autosuggestions-config/autosuggestions-config-user-specified";

// Like the base copilot textarea props,
// but with baseAutosuggestionsConfig replaced with autosuggestionsConfig.
export interface CopilotTextareaProps
  extends Omit<BaseCopilotTextareaProps, "baseAutosuggestionsConfig"> {
  /**
   * Configuration settings for the autosuggestions feature.
   * Includes a mandatory `textareaPurpose` to guide the autosuggestions.
   *
   * Autosuggestions can be configured as follows:
   *
   * ```ts
   * {
   *  // the purpose of the textarea
   *  textareaPurpose: string,
   *  chatApiConfigs: {
   *    // the config for the suggestions api (optional)
   *    suggestionsApiConfig: {
   *      // use this to provide a custom system prompt
   *      makeSystemPrompt: (textareaPurpose: string, contextString: string) => string;
   *      // custom few shot messages
   *      fewShotMessages: MinimalChatGPTMessage[];
   *      forwardedParams: {
   *        // max number of tokens to generate
   *        max_tokens: number,
   *        // stop generating when these characters are encountered, e.g. [".", "?", "!"]
   *        stop: string[],
   *      },
   *    },
   *    insertionApiConfig: //... the same options as suggestionsApiConfig
   *  },
   * }
   * ```
   */
  autosuggestionsConfig: AutosuggestionsConfigUserSpecified;
}

/**
 * A copilot textarea that uses the standard autosuggestions function.
 */
export const CopilotTextarea = React.forwardRef(
  (props: CopilotTextareaProps, ref: React.Ref<HTMLCopilotTextAreaElement>) => {
    // separate the AutosuggestionsConfigUserSpecified from the rest of the props
    const { autosuggestionsConfig: autosuggestionsConfigUserSpecified, ...forwardedProps } = props;

    const autosuggestionsConfig: AutosuggestionsConfig = merge(
      defaultAutosuggestionsConfig,
      autosuggestionsConfigUserSpecified,
    );

    const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.contextCategories,
      autosuggestionsConfig.chatApiConfigs.suggestionsApiConfig,
    );

    const insertionOrEditingFunction = useMakeStandardInsertionOrEditingFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.contextCategories,
      autosuggestionsConfig.chatApiConfigs.insertionApiConfig,
      autosuggestionsConfig.chatApiConfigs.editingApiConfig,
    );

    return (
      <>
        <BaseCopilotTextarea
          ref={ref}
          {...forwardedProps}
          baseAutosuggestionsConfig={{
            ...autosuggestionsConfig,
            apiConfig: {
              insertionOrEditingFunction: insertionOrEditingFunction,
              autosuggestionsFunction: autosuggestionsFunction,
            },
          }}
        />
      </>
    );
  },
);
