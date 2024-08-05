/**
 * <br/>
 * <img src="/images/CopilotPopup.gif" width="500" />
 *
 * A chatbot popup component for the CopilotKit framework. The component allows for a high degree
 * of customization through various props and custom CSS.
 *
 * See [CopilotSidebar](/reference/components/CopilotSidebar) for a sidebar version of this component.
 *
 * ## Example
 *
 * ```tsx
 * import { CopilotPopup } from "@copilotkit/react-ui";
 *
 * <CopilotPopup
 *   labels={{
 *     title: "Your Assistant",
 *     initial: "Hi! 👋 How can I assist you today?",
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
 * ```tsx
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

import { CopilotModal, CopilotModalProps } from "./Modal";

export function CopilotPopup(props: CopilotModalProps) {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitPopup" : "copilotKitPopup",
  };
  return <CopilotModal {...props}>{props.children}</CopilotModal>;
}
