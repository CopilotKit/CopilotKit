/**
 * <br/>
 * <img src="/images/CopilotSidebar.gif" width="500" />
 *
 * A chatbot sidebar component for the CopilotKit framework. Highly customizable through various props and custom CSS.
 *
 * See [CopilotPopup](/reference/components/CopilotPopup) for a popup version of this component.
 *
 * ## Example
 *
 * ```tsx
 * import { CopilotSidebar } from "@copilotkit/react-ui";
 *
 * <CopilotSidebar
 *   labels={{
 *     title: "Your Assistant",
 *     initial: "Hi! 👋 How can I assist you today?",
 *   }}
 * >
 *   <YourApp/>
 * </CopilotSidebar>
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
 * ### Custom Styles
 *
 * To opt-in for the built-in styles, make sure to import the following at the root of your application:
 *
 * ```tsx
 * import "@copilotkit/react-ui/styles.css";
 * ```
 *
 * You can customize the colors of the chat window by overriding the CSS variables
 * defined in the [default styles](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-ui/src/css/colors.css).
 *
 * For example, to set the primary color to purple:
 *
 * ```jsx
 * <div style={{ "--copilot-kit-primary-color": "#7D5BA6" }}>
 *   <CopilotSidebar />
 * </div>
 * ```
 *
 * To further customize the chat window, you can override the CSS classes defined
 * [here](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-ui/src/css/).
 *
 * For example:
 *
 * ```css
 * .copilotKitButton {
 *   border-radius: 0;
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
