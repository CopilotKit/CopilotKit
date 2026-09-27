import React, { useContext, useEffect, useMemo } from "react";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import { InlineFeatureWarning } from "../license-warning-banner";

import type { CopilotChatProps } from "./CopilotChat";
import { CopilotChat } from "./CopilotChat";
import type { CopilotChatViewProps } from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import type { CopilotPopupViewProps } from "./CopilotPopupView";
import CopilotPopupView from "./CopilotPopupView";
import { ModalOpenControlProvider } from "./modal-open-control";
import { ModalThreadsScope } from "./modal-threads-drawer";

/**
 * Carries the popup shell props (header, toggle, width, height, …) to the
 * chatView override without baking them into the override's component
 * identity. Width/height change on every resize; if they were `useMemo`
 * dependencies of the override component, each change would mint a new
 * component function, and rendering a new element *type* makes React unmount
 * and remount the entire chat subtree — resetting scrollTop to 0 and firing
 * `initial="smooth"`, which visibly scrolls the message list from top to
 * bottom on every resize. Routing them through context keeps the override
 * identity stable (no remount) while still re-rendering CopilotPopupView with
 * the new dimensions on change.
 */
type PopupShellProps = {
  header?: CopilotPopupViewProps["header"];
  toggleButton?: CopilotPopupViewProps["toggleButton"];
  width?: CopilotPopupViewProps["width"];
  height?: CopilotPopupViewProps["height"];
  clickOutsideToClose?: CopilotPopupViewProps["clickOutsideToClose"];
  defaultOpen?: boolean;
  threadsDrawer?: CopilotPopupViewProps["threadsDrawer"];
};

const PopupShellPropsContext = React.createContext<PopupShellProps>({});

// Stable override component. Its identity never changes, so the chat subtree
// is never remounted on resize. Popup props flow in via context, so changing
// width/height re-renders CopilotPopupView (a style update) instead.
const PopupViewOverride: React.FC<CopilotChatViewProps> = (viewProps) => {
  const {
    header: viewHeader,
    toggleButton: viewToggleButton,
    width: viewWidth,
    height: viewHeight,
    clickOutsideToClose: viewClickOutsideToClose,
    defaultOpen: viewDefaultOpen,
    threadsDrawer: viewThreadsDrawer,
    ...restProps
  } = viewProps as CopilotPopupViewProps;

  const shell = useContext(PopupShellPropsContext);

  return (
    <CopilotPopupView
      {...(restProps as CopilotPopupViewProps)}
      header={shell.header ?? viewHeader}
      toggleButton={shell.toggleButton ?? viewToggleButton}
      width={shell.width ?? viewWidth}
      height={shell.height ?? viewHeight}
      clickOutsideToClose={shell.clickOutsideToClose ?? viewClickOutsideToClose}
      defaultOpen={shell.defaultOpen ?? viewDefaultOpen}
      threadsDrawer={shell.threadsDrawer ?? viewThreadsDrawer}
    />
  );
};

// Preserve the static slot members (WelcomeScreen, etc.) that callers reach
// through the CopilotChatView namespace. The cast restores those statics on
// the type after Object.assign, matching the shape CopilotChat's `chatView`
// slot expects (typeof CopilotChatView).
const PopupViewOverrideWithStatics = Object.assign(
  PopupViewOverride,
  CopilotChatView,
) as typeof CopilotChatView;

export type CopilotPopupProps = Omit<CopilotChatProps, "chatView"> & {
  header?: CopilotPopupViewProps["header"];
  toggleButton?: CopilotPopupViewProps["toggleButton"];
  defaultOpen?: boolean;
  /**
   * Controlled open state. When supplied, the host owns whether the popup is
   * open: the popup renders this value and never changes it on its own. Pair it
   * with `onOpenChange` to react to the toggle button and to click-outside.
   * Omit it (and use `defaultOpen`) to let the popup manage its own state.
   */
  open?: boolean;
  /**
   * Called with the requested state whenever the popup asks to open or close
   * (the toggle button, click-outside, or the thread drawer on mobile). In
   * controlled mode nothing moves until the host updates `open`.
   */
  onOpenChange?: (open: boolean) => void;
  width?: CopilotPopupViewProps["width"];
  height?: CopilotPopupViewProps["height"];
  clickOutsideToClose?: CopilotPopupViewProps["clickOutsideToClose"];
  /**
   * Adds a threads drawer to the popup: a thread-list launcher in the header
   * opens it as a panel sliding in over the chat. Pass `true` for the default
   * drawer or an object of `CopilotThreadsDrawer` props to configure it.
   * Defaults to off. See `CopilotPopupViewProps["threadsDrawer"]`.
   */
  threadsDrawer?: CopilotPopupViewProps["threadsDrawer"];
};

export function CopilotPopup({
  header,
  toggleButton,
  defaultOpen,
  open,
  onOpenChange,
  width,
  height,
  clickOutsideToClose,
  threadsDrawer,
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

  const shellProps = useMemo<PopupShellProps>(
    () => ({
      header,
      toggleButton,
      width,
      height,
      clickOutsideToClose,
      defaultOpen,
      threadsDrawer,
    }),
    [
      clickOutsideToClose,
      header,
      toggleButton,
      height,
      width,
      defaultOpen,
      threadsDrawer,
    ],
  );

  return (
    <>
      {!isPopupLicensed && <InlineFeatureWarning featureName="Popup" />}
      <PopupShellPropsContext.Provider value={shellProps}>
        <ModalThreadsScope enabled={Boolean(threadsDrawer)}>
          <ModalOpenControlProvider open={open} onOpenChange={onOpenChange}>
            <CopilotChat
              welcomeScreen={CopilotPopupView.WelcomeScreen}
              {...chatProps}
              isModalDefaultOpen={defaultOpen}
              chatView={PopupViewOverrideWithStatics}
            />
          </ModalOpenControlProvider>
        </ModalThreadsScope>
      </PopupShellPropsContext.Provider>
    </>
  );
}

CopilotPopup.displayName = "CopilotPopup";

export default CopilotPopup;
