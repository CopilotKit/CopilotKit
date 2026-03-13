import React, { useMemo } from "react";

import { CopilotChat, CopilotChatProps } from "./CopilotChat";
import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import {
  CopilotSidebarView,
  CopilotSidebarViewProps,
} from "./CopilotSidebarView";

export type CopilotSidebarProps = Omit<CopilotChatProps, "chatView"> & {
  header?: CopilotSidebarViewProps["header"];
  toggleButton?: CopilotSidebarViewProps["toggleButton"];
  defaultOpen?: boolean;
  width?: number | string;
};

export function CopilotSidebar({
  header,
  toggleButton,
  defaultOpen,
  width,
  ...chatProps
}: CopilotSidebarProps) {
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
    <CopilotChat
      welcomeScreen={CopilotSidebarView.WelcomeScreen}
      {...chatProps}
      chatView={SidebarViewOverride}
    />
  );
}

CopilotSidebar.displayName = "CopilotSidebar";

export default CopilotSidebar;
