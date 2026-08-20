/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — CopilotPopup:
 *   V2 import and usage:
 *     import { CopilotPopup } from "@copilotkit/react-core/v2";
 *     <CopilotPopup />;
 *   V2 replacement source: packages/react-core/src/v2/components/chat/CopilotPopup.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/components/CopilotPopup
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * <br/>
 * <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/CopilotPopup.gif" width="500" />
 *
 * A chatbot popup component for the CopilotKit framework. The component allows for a high degree
 * of customization through various props and custom CSS.
 *
 * See [CopilotSidebar](/reference/v1/components/chat/CopilotSidebar) for a sidebar version of this component.
 *
 * ## Install Dependencies
 *
 * This component is part of the [@copilotkit/react-ui](https://npmjs.com/package/@copilotkit/react-ui) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-ui"\
 * npm install @copilotkit/react-core @copilotkit/react-ui
 * ```
 * ## Usage
 *
 * ```tsx
 * import { CopilotPopup } from "@copilotkit/react-ui";
 * import "@copilotkit/react-ui/styles.css";
 *
 * <CopilotPopup
 *   labels={{
 *     title: "Your Assistant",
 *     initial: "Hi! 👋 How can I assist you today?",
 *   }}
 * />
 * ```
 *
 * ### With Observability Hooks
 *
 * To monitor user interactions, provide the `observabilityHooks` prop.
 *
 * ```tsx
 * <CopilotKit>
 *   <CopilotPopup
 *     observabilityHooks={{
 *       onChatExpanded: () => {
 *         console.log("Popup opened");
 *       },
 *       onChatMinimized: () => {
 *         console.log("Popup closed");
 *       },
 *     }}
 *   />
 * </CopilotKit>
 * ```
 *
 * ### Look & Feel
 *
 * By default, CopilotKit components do not have any styles. You can import CopilotKit's stylesheet at the root of your project:
 * ```tsx title="YourRootComponent.tsx"
 * ...
 * import "@copilotkit/react-ui/styles.css"; // [!code highlight]
 *
 * export function YourRootComponent() {
 *   return (
 *     <CopilotKit>
 *       ...
 *     </CopilotKit>
 *   );
 * }
 * ```
 * For more information about how to customize the styles, check out the [Customize Look & Feel](/guides/custom-look-and-feel/customize-built-in-ui-components) guide.
 */

import type { CopilotModalProps } from "./Modal";
import { CopilotModal } from "./Modal";

export function CopilotPopup(props: CopilotModalProps) {
  props = {
    ...props,
    className: props.className
      ? props.className + " copilotKitPopup"
      : "copilotKitPopup",
  };
  return <CopilotModal {...props}>{props.children}</CopilotModal>;
}
