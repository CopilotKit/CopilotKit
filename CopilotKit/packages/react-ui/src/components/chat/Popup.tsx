/**
 * A chatbot popup component for CopilotKit.
 *
 * <img src="/images/CopilotPopup/CopilotPopup.gif" width="500" />
 *
 * <img referrerPolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be" />
 *
 * A chatbot popup component for the CopilotKit framework. The component allows for a high degree
 * of customization through various props and custom CSS.
 *
 * See [CopilotSidebar](./CopilotSidebar) for a sidebar version of this component.
 *
 * <RequestExample>
 *   ```jsx CopilotPopup Example
 *   import { CopilotPopup } from "@copilotkit/react-ui";
 *
 *   <CopilotPopup
 *     labels={{
 *       title: "Your Assistant",
 *       initial: "Hi! 👋 How can I assist you today?",
 *     }}
 *   />
 *   ```
 * </RequestExample>
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
 *   <CopilotPopup />
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

import { CopilotChat, CopilotChatProps } from "./Chat";

export function CopilotPopup(props: CopilotChatProps) {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitPopup" : "copilotKitPopup",
  };
  return <CopilotChat {...props}>{props.children}</CopilotChat>;
}
