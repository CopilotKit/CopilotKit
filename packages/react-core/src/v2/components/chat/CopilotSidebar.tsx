import React, { useEffect, useMemo } from "react";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import { InlineFeatureWarning } from "../license-warning-banner";

import { CopilotChat, CopilotChatProps } from "./CopilotChat";
import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import {
  CopilotSidebarView,
  CopilotSidebarViewProps,
} from "./CopilotSidebarView";

export type CopilotSidebarProps = Omit<CopilotChatProps, "chatView" | "isModalOpen" | "onModalOpenChange"> & {
  header?: CopilotSidebarViewProps["header"];
  toggleButton?: CopilotSidebarViewProps["toggleButton"];
  defaultOpen?: boolean;
  /** Controlled mode: external source of truth for open/close state. */
  isOpen?: boolean;
  /** Callback fired when the sidebar wants to change its open state. */
  onOpenChange?: (open: boolean) => void;
  width?: number | string;
};

export function CopilotSidebar({
  header,
  toggleButton,
  defaultOpen,
  isOpen,
  onOpenChange,
  width,
  ...chatProps
}: CopilotSidebarProps) {
  const { checkFeature } = useLicenseContext();
  const isSidebarLicensed = checkFeature("sidebar");

  useEffect(() => {
    if (!isSidebarLicensed) {
      console.warn(
        '[CopilotKit] Warning: "sidebar" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  }, [isSidebarLicensed]);

  const SidebarViewOverride = useMemo(() => {
    const Component: React.FC<CopilotChatViewProps> = (viewProps) => {
      const {
        header: viewHeader,
        toggleButton: viewToggleButton,
        width: viewWidth,
        defaultOpen: viewDefaultOpen,
        ...restProps
      } = viewProps as CopilotSidebarViewProps;

      return (
        <CopilotSidebarView
          {...(restProps as CopilotSidebarViewProps)}
          header={header ?? viewHeader}
          toggleButton={toggleButton ?? viewToggleButton}
          width={width ?? viewWidth}
          defaultOpen={defaultOpen ?? viewDefaultOpen}
        />
      );
    };

    return Object.assign(Component, CopilotChatView);
  }, [header, toggleButton, width, defaultOpen]);

  return (
    <>
      {!isSidebarLicensed && <InlineFeatureWarning featureName="Sidebar" />}
      <CopilotChat
        welcomeScreen={CopilotSidebarView.WelcomeScreen}
        {...chatProps}
        isModalDefaultOpen={defaultOpen}
        isModalOpen={isOpen}
        onModalOpenChange={onOpenChange}
        chatView={SidebarViewOverride}
      />
    </>
  );
}

CopilotSidebar.displayName = "CopilotSidebar";

export default CopilotSidebar;
