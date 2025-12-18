import React, { useMemo } from "react";

import { CopilotChat, CopilotChatProps } from "./CopilotChat";
import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import { CopilotPopupView, CopilotPopupViewProps } from "./CopilotPopupView";

export type CopilotPopupProps = Omit<CopilotChatProps, "chatView"> & {
  header?: CopilotPopupViewProps["header"];
  defaultOpen?: boolean;
  width?: CopilotPopupViewProps["width"];
  height?: CopilotPopupViewProps["height"];
  clickOutsideToClose?: CopilotPopupViewProps["clickOutsideToClose"];
};

export function CopilotPopup({
  header,
  defaultOpen,
  width,
  height,
  clickOutsideToClose,
  ...chatProps
}: CopilotPopupProps) {
  const PopupViewOverride = useMemo(() => {
    const Component: React.FC<CopilotChatViewProps> = (viewProps) => {
      const {
        header: viewHeader,
        width: viewWidth,
        height: viewHeight,
        clickOutsideToClose: viewClickOutsideToClose,
        ...restProps
      } = viewProps as CopilotPopupViewProps;

      return (
        <CopilotPopupView
          {...(restProps as CopilotPopupViewProps)}
          header={header ?? viewHeader}
          width={width ?? viewWidth}
          height={height ?? viewHeight}
          clickOutsideToClose={clickOutsideToClose ?? viewClickOutsideToClose}
        />
      );
    };

    return Object.assign(Component, CopilotChatView);
  }, [clickOutsideToClose, header, height, width]);

  return (
    <CopilotChat
      {...chatProps}
      chatView={PopupViewOverride}
      isModalDefaultOpen={defaultOpen}
    />
  );
}

CopilotPopup.displayName = "CopilotPopup";

export default CopilotPopup;
