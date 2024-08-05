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
 *
 * ## Example
 *
 * ```tsx
 * import { CopilotTextarea } from '@copilot/react-ui';
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
 * This component is part of the [@copilotkit/react-ui](https://npmjs.com/package/@copilotkit/react-ui) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-ui"\
 * npm install @copilotkit/react-core @copilotkit/react-ui
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
 *             max_tokens: 20,
 *             stop: [".", "?", "!"],
 *           },
 *         },
 *       }}
 *     />
 *   );
 * }
 * ```
 */
import React, { useState } from "react";
import { CopilotModal, CopilotModalProps } from "./Modal";

export function CopilotSidebar(props: CopilotModalProps) {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitSidebar" : "copilotKitSidebar",
  };
  const [expandedClassName, setExpandedClassName] = useState(
    props.defaultOpen ? "sidebarExpanded" : "",
  );

  const onSetOpen = (open: boolean) => {
    props.onSetOpen?.(open);
    setExpandedClassName(open ? "sidebarExpanded" : "");
  };

  return (
    <div className={`copilotKitSidebarContentWrapper ${expandedClassName}`}>
      <CopilotModal {...props} {...{ onSetOpen }}>
        {props.children}
      </CopilotModal>
    </div>
  );
}
