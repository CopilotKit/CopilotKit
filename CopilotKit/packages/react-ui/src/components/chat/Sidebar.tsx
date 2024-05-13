/**
 * A chatbot sidebar component for CopilotKit.
 *
 * <img src="/images/CopilotSidebar/CopilotSidebar.gif" width="500" />
 *
 * <img referrerPolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be" />
 *
 * A chatbot sidebar component for the CopilotKit framework. Highly customizable through various props and custom CSS.
 *
 * <RequestExample>
 *   ```jsx CopilotSidebar Example
 *   import { CopilotSidebar } from "@copilotkit/react-ui";
 *
 *   <CopilotSidebar
 *     labels={{
 *       title: "Your Assistant",
 *       initial: "Hi! 👋 How can I assist you today?",
 *     }}
 *   >
 *     <YourApp/>
 *   </CopilotSidebar>
 *   ```
 * </RequestExample>
 *
 *
 * See [CopilotPopup](./CopilotPopup) for a popup version of this component.
 *
 * <Note>
 *   To make the sidebar push your content to the side, wrap your content in the
 *   sidebar component. If you want the sidebar to overlay your content, place the
 *   sidebar component outside of your content.
 * </Note>
 *
 * ## Custom CSS
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
import { CopilotChat, CopilotChatProps } from "./Chat";

export function CopilotSidebar(props: CopilotChatProps) {
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
      <CopilotChat {...props} {...{ onSetOpen }}>
        {props.children}
      </CopilotChat>
    </div>
  );
}
