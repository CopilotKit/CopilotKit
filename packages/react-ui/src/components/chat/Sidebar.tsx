/**
 * <br/>
 * <img src="https://cdn.copilotkit.ai/docs/copilotkit/images/CopilotSidebar.gif" width="500" />
 *
 * A chatbot sidebar component for the CopilotKit framework. Highly customizable through various props and custom CSS.
 *
 * See [CopilotPopup](/reference/v1/components/chat/CopilotPopup) for a popup version of this component.
 *
 * ## Install Dependencies
 *
 * This component is part of the [@copilotkit/react-ui](https://npmjs.com/package/@copilotkit/react-ui) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-ui"\
 * npm install @copilotkit/react-core @copilotkit/react-ui
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import { CopilotSidebar } from "@copilotkit/react-ui";
 * import "@copilotkit/react-ui/styles.css";
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
 * ### With Observability Hooks
 *
 * To monitor user interactions, provide the `observabilityHooks` prop.
 *
 * ```tsx
 * <CopilotKit>
 *   <CopilotSidebar
 *     observabilityHooks={{
 *       onChatExpanded: () => {
 *         console.log("Sidebar opened");
 *       },
 *       onChatMinimized: () => {
 *         console.log("Sidebar closed");
 *       },
 *     }}
 *   >
 *     <YourApp/>
 *   </CopilotSidebar>
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
import React, { useState } from "react";
import type { CopilotModalProps } from "./Modal";
import { CopilotModal } from "./Modal";

export interface CopilotSidebarProps extends CopilotModalProps {
  /**
   * Make the sidebar's content wrapper exactly one viewport tall, so children
   * can use `height: 100%` (or `flex: 1`) to fill the screen.
   *
   * Off by default: the wrappers are auto-height, so page content flows
   * normally and percentage heights on children collapse to content height.
   *
   * ```tsx
   * <CopilotSidebar fullHeightChildren>
   *   <div style={{ height: "100%" }}>...</div>
   * </CopilotSidebar>
   * ```
   */
  fullHeightChildren?: boolean;
}

export function CopilotSidebar({
  fullHeightChildren = false,
  ...props
}: CopilotSidebarProps) {
  props = {
    ...props,
    className: props.className
      ? props.className + " copilotKitSidebar"
      : "copilotKitSidebar",
  };
  const [expandedClassName, setExpandedClassName] = useState(
    props.defaultOpen ? "sidebarExpanded" : "",
  );

  const onSetOpen = (open: boolean) => {
    props.onSetOpen?.(open);
    setExpandedClassName(open ? "sidebarExpanded" : "");
  };

  const contentWrapperClassName = [
    "copilotKitSidebarContentWrapper",
    expandedClassName,
    fullHeightChildren ? "copilotKitSidebarFullHeightChildren" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={contentWrapperClassName}>
      <CopilotModal {...props} {...{ onSetOpen }}>
        {props.children}
      </CopilotModal>
    </div>
  );
}
