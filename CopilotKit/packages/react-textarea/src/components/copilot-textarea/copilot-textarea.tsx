/**
 * <br/>
 * <img src="/images/CopilotTextarea.gif" width="500" />
 *
 * `<CopilotTextarea>` is a React component that acts as a drop-in replacement for the standard `<textarea>`,
 *  offering enhanced autocomplete features powered by AI. It is context-aware, integrating seamlessly with the
 * [`useCopilotReadable`](/reference/hooks/useCopilotReadable) hook to provide intelligent suggestions based on the application context.
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
 * For more information about how to customize the styles, check out the [Customize Look & Feel](/concepts/customize-look-and-feel) guide.
 * */
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
   * For full reference, [check the interface on GitHub](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-textarea/src/types/base/base-copilot-textarea-props.tsx#L8).
   *
   * <PropertyReference name="textareaPurpose" type="string" required={true} >
   *   The purpose of the text area in plain text.
   *
   *   Example: *"The body of the email response"*
   * </PropertyReference>
   *
   * <PropertyReference name="chatApiConfigs" type="ChatApiConfigs" >
   *   The chat API configurations.
   *
   *   <strong>NOTE:</strong> You must provide specify at least one of `suggestionsApiConfig` or `insertionApiConfig`.
   *
   *   <PropertyReference name="suggestionsApiConfig" type="SuggestionsApiConfig">
   *       For full reference, please [click here](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-textarea/src/types/autosuggestions-config/suggestions-api-config.tsx#L4).
   *   </PropertyReference>
   *   <PropertyReference name="insertionApiConfig" type="InsertionApiConfig">
   *       For full reference, please [click here](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-textarea/src/types/autosuggestions-config/insertions-api-config.tsx#L4).
   *   </PropertyReference>
   * </PropertyReference>
   *
   * <PropertyReference name="disabled" type="boolean" >
   *   Whether the textarea is disabled.
   * </PropertyReference>
   *
   * <PropertyReference name="disableBranding" type="boolean" >
   *   Whether to disable the CopilotKit branding.
   * </PropertyReference>
   *
   * <PropertyReference name="placeholderStyle" type="React.CSSProperties" >
   *   Specifies the CSS styles to apply to the placeholder text.
   * </PropertyReference>
   *
   * <PropertyReference name="suggestionsStyle" type="React.CSSProperties" >
   *   Specifies the CSS styles to apply to the suggestions list.
   * </PropertyReference>
   *
   * <PropertyReference name="hoverMenuClassname" type="string" >
   *   A class name to apply to the editor popover window.
   * </PropertyReference>
   *
   * <PropertyReference name="value" type="string" >
   *   The initial value of the textarea. Can be controlled via `onValueChange`.
   * </PropertyReference>
   *
   * <PropertyReference name="onValueChange" type="(value: string) => void" >
   *   Callback invoked when the value of the textarea changes.
   * </PropertyReference>
   *
   * <PropertyReference name="onChange" type="(event: React.ChangeEvent<HTMLTextAreaElement>) => void" >
   *   Callback invoked when a `change` event is triggered on the textarea element.
   * </PropertyReference>
   *
   * <PropertyReference name="shortcut" type="string" >
   *   The shortcut to use to open the editor popover window. Default is `"Cmd-k"`.
   * </PropertyReference>
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
