/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-textarea — CopilotTextarea:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-textarea — CopilotTextareaProps:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * <Callout type="info">
 *   `CopilotTextarea` has no direct v2 replacement. See the [v1 to v2 export map](/reference/v1/export-map).
 * </Callout>
 *
 * <br/>
 * <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/CopilotTextarea.gif" width="500" />
 *
 * `<CopilotTextarea>` is a React component that acts as a drop-in replacement for the standard `<textarea>`,
 *  offering enhanced autocomplete features powered by AI. It is context-aware, integrating with the
 * [`useCopilotReadable`](/reference/v1/hooks/useCopilotReadable) hook to provide intelligent suggestions based on the application context.
 *
 * In addition, it provides a hovering editor window (available by default via `Cmd + K` on Mac and `Ctrl + K` on Windows) that allows the user to
 * suggest changes to the text, for example providing a summary or rephrasing the text.
 *
 * ## Example
 *
 * ```tsx
 * import { CopilotTextarea } from '@copilotkit/react-textarea';
 * import "@copilotkit/react-textarea/styles.css";
 *
 * <CopilotTextarea
 *   autosuggestionsConfig={{
 *     textareaPurpose:
 *      "the body of an email message",
 *     chatApiConfigs: {},
 *   }}
 * />
 * ```
 *
 * ## Usage
 *
 * ### Install Dependencies
 *
 * This component is part of the [@copilotkit/react-textarea](https://npmjs.com/package/@copilotkit/react-textarea) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-textarea"\
 * npm install @copilotkit/react-core @copilotkit/react-textarea
 * ```
 *
 * ### Usage
 *
 * Use the CopilotTextarea component in your React application similarly to a standard `<textarea />`,
 * with additional configurations for AI-powered features.
 *
 * For example:
 *
 * ```tsx
 * import { useState } from "react";
 * import { CopilotTextarea } from "@copilotkit/react-textarea";
 * import "@copilotkit/react-textarea/styles.css";
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
 *             maxTokens: 20,
 *             stop: [".", "?", "!"],
 *           },
 *         },
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * ### Look & Feel
 *
 * By default, CopilotKit components do not have any styles. You can import CopilotKit's stylesheet at the root of your project:
 * ```tsx title="YourRootComponent.tsx"
 * ...
 * import "@copilotkit/react-textarea/styles.css"; // [!code highlight]
 *
 * export function YourRootComponent() {
 *   return (
 *     <CopilotKit>
 *       ...
 *     </CopilotKit>
 *   );
 * }
 * ```
 * */
import React from "react";
import { useMakeStandardAutosuggestionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-autosuggestions-function";
import type { HTMLCopilotTextAreaElement } from "../../types";
import type { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import type { AutosuggestionsConfig } from "../../types/autosuggestions-config";
import { defaultAutosuggestionsConfig } from "../../types/autosuggestions-config";
import { BaseCopilotTextarea } from "../base-copilot-textarea/base-copilot-textarea";
import { useMakeStandardInsertionOrEditingFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-insertion-function";
import merge from "lodash.merge";
import type { AutosuggestionsConfigUserSpecified } from "../../types/autosuggestions-config/autosuggestions-config-user-specified";

// Like the base copilot textarea props,
// but with baseAutosuggestionsConfig replaced with autosuggestionsConfig.
/**
 * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
 * No 1:1 v2 replacement is available.
 * Start with `@copilotkit/react-core/v2`.
 * V2 docs: https://docs.copilotkit.ai/
 * V2 reference docs: https://docs.copilotkit.ai/reference/v2
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 */
export interface CopilotTextareaProps extends Omit<
  BaseCopilotTextareaProps,
  "baseAutosuggestionsConfig"
> {
  /**
   * Configuration settings for the autosuggestions feature.
   * For full reference, [check the interface on GitHub](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-textarea/src/types/base/base-copilot-textarea-props.tsx#L8).
   *
   * <PropertyReference name="textareaPurpose" type="string" required={true} >
   *   The purpose of the text area in plain text.
   *
   *   Example: *"The body of the email response"*
   * </PropertyReference>
   *
   * <PropertyReference name="chatApiConfigs" type="ChatApiConfigs" required={true} >
   *   The chat API configurations.
   *
   *   Both fields are optional. CopilotKit uses its default config for any field that you leave out, so `chatApiConfigs: {}` is valid.
   *
   *   <PropertyReference name="suggestionsApiConfig" type="SuggestionsApiConfig">
   *       For full reference, please [click here](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-textarea/src/types/autosuggestions-config/suggestions-api-config.tsx#L4).
   *   </PropertyReference>
   *   <PropertyReference name="insertionApiConfig" type="InsertionApiConfig">
   *       For full reference, please [click here](https://github.com/CopilotKit/CopilotKit/blob/main/packages/react-textarea/src/types/autosuggestions-config/insertions-api-config.tsx#L4).
   *   </PropertyReference>
   * </PropertyReference>
   *
   * <PropertyReference name="disabled" type="boolean" >
   *   Turns off autosuggestions. The textarea stays editable.
   * </PropertyReference>
   *
   * <PropertyReference name="contextCategories" type="string[]" >
   *   The categories of context to consider for autosuggestions.
   * </PropertyReference>
   *
   * <PropertyReference name="debounceTime" type="number" default="250" >
   *   The time in milliseconds to wait after the user stops typing before autosuggestions start.
   * </PropertyReference>
   *
   * <PropertyReference name="disableWhenEmpty" type="boolean" default="true" >
   *   Turns off autosuggestions while the textarea is empty.
   * </PropertyReference>
   *
   * <PropertyReference name="temporarilyDisableWhenMovingCursorWithoutChangingText" type="boolean" default="true" >
   *   Pauses autosuggestions when the user moves the cursor without changing the text.
   * </PropertyReference>
   *
   * <PropertyReference name="temporarilyDisableNotTrustedEvents" type="boolean" default="true" >
   *   Pauses autosuggestions after a change event from an untrusted source, such as an autocomplete plugin.
   * </PropertyReference>
   */
  autosuggestionsConfig: AutosuggestionsConfigUserSpecified;
}

/**
 * A copilot textarea that uses the standard autosuggestions function.
 *
 * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
 * No 1:1 v2 replacement is available.
 * Start with `@copilotkit/react-core/v2`.
 * V2 docs: https://docs.copilotkit.ai/
 * V2 reference docs: https://docs.copilotkit.ai/reference/v2
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 */
export const CopilotTextarea = React.forwardRef(
  (props: CopilotTextareaProps, ref: React.Ref<HTMLCopilotTextAreaElement>) => {
    // separate the AutosuggestionsConfigUserSpecified from the rest of the props
    const {
      autosuggestionsConfig: autosuggestionsConfigUserSpecified,
      ...forwardedProps
    } = props;

    const autosuggestionsConfig: AutosuggestionsConfig = merge(
      defaultAutosuggestionsConfig,
      autosuggestionsConfigUserSpecified,
    );

    const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.contextCategories,
      autosuggestionsConfig.chatApiConfigs.suggestionsApiConfig,
    );

    const insertionOrEditingFunction =
      useMakeStandardInsertionOrEditingFunction(
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
