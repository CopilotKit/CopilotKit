/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — CopilotSidebar:
 *   V2 import and usage:
 *     import { CopilotSidebar } from "@copilotkit/react-core/v2";
 *     <CopilotSidebar />;
 *   V2 replacement source: packages/react-core/src/v2/components/chat/CopilotSidebar.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/components/CopilotSidebar
 *
 * @copilotkit/react-ui — CopilotSidebarProps:
 *   V2 import and usage:
 *     import type { CopilotSidebarProps } from "@copilotkit/react-core/v2";
 *     type V2CopilotSidebarProps = CopilotSidebarProps;
 *   V2 replacement source: packages/react-core/src/v2/components/chat/CopilotSidebar.tsx
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
