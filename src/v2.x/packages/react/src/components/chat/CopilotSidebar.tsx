import React, { useMemo } from "react";

import { CopilotChat, CopilotChatProps } from "./CopilotChat";
import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import { CopilotSidebarView, CopilotSidebarViewProps } from "./CopilotSidebarView";

export type CopilotSidebarProps = Omit<CopilotChatProps, "chatView"> & {
  header?: CopilotSidebarViewProps["header"];
  defaultOpen?: boolean;
  width?: number | string;
};

export function CopilotSidebar({ header, defaultOpen, width, ...chatProps }: CopilotSidebarProps) {
  const SidebarViewOverride = useMemo(() => {
    const Component: React.FC<CopilotChatViewProps> = (viewProps) => {
      const { header: viewHeader, width: viewWidth, ...restProps } = viewProps as CopilotSidebarViewProps;

      return (
        <CopilotSidebarView
          {...(restProps as CopilotSidebarViewProps)}
          header={header ?? viewHeader}
          width={width ?? viewWidth}
        />
      );
    };

    return Object.assign(Component, CopilotChatView);
  }, [header, width]);

  return (
    <CopilotChat
      {...chatProps}
      chatView={SidebarViewOverride}
      isModalDefaultOpen={defaultOpen}
    />
  );
}

CopilotSidebar.displayName = "CopilotSidebar";

export default CopilotSidebar;
