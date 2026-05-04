import React, { useEffect, useMemo } from "react";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import { InlineFeatureWarning } from "../license-warning-banner";

import { CopilotChat, CopilotChatProps } from "./CopilotChat";
import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import CopilotPopupView, { CopilotPopupViewProps } from "./CopilotPopupView";

export type CopilotPopupProps = Omit<CopilotChatProps, "chatView"> & {
  header?: CopilotPopupViewProps["header"];
  toggleButton?: CopilotPopupViewProps["toggleButton"];
  defaultOpen?: boolean;
  width?: CopilotPopupViewProps["width"];
  height?: CopilotPopupViewProps["height"];
  clickOutsideToClose?: CopilotPopupViewProps["clickOutsideToClose"];
};

export function CopilotPopup({
  header,
  toggleButton,
  defaultOpen,
  width,
  height,
  clickOutsideToClose,
  ...chatProps
}: CopilotPopupProps) {
  const { checkFeature } = useLicenseContext();
  const isPopupLicensed = checkFeature("popup");

  useEffect(() => {
    if (!isPopupLicensed) {
      console.warn(
        '[CopilotKit] Warning: "popup" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  }, [isPopupLicensed]);

  const PopupViewOverride = useMemo(() => {
    const Component: React.FC<CopilotChatViewProps> = (viewProps) => {
      const {
        header: viewHeader,
        toggleButton: viewToggleButton,
        width: viewWidth,
        height: viewHeight,
        clickOutsideToClose: viewClickOutsideToClose,
        defaultOpen: viewDefaultOpen,
        ...restProps
      } = viewProps as CopilotPopupViewProps;

      return (
        <CopilotPopupView
          {...(restProps as CopilotPopupViewProps)}
          header={header ?? viewHeader}
          toggleButton={toggleButton ?? viewToggleButton}
          width={width ?? viewWidth}
          height={height ?? viewHeight}
          clickOutsideToClose={clickOutsideToClose ?? viewClickOutsideToClose}
          defaultOpen={defaultOpen ?? viewDefaultOpen}
        />
      );
    };

    return Object.assign(Component, CopilotChatView);
  }, [clickOutsideToClose, header, toggleButton, height, width, defaultOpen]);

  return (
    <>
      {!isPopupLicensed && <InlineFeatureWarning featureName="Popup" />}
      <CopilotChat
        welcomeScreen={CopilotPopupView.WelcomeScreen}
        {...chatProps}
        isModalDefaultOpen={defaultOpen}
        chatView={PopupViewOverride}
      />
    </>
  );
}

CopilotPopup.displayName = "CopilotPopup";

export default CopilotPopup;
