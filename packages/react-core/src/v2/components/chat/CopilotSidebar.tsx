import React, { useContext, useEffect, useMemo } from "react";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import { InlineFeatureWarning } from "../license-warning-banner";

import type { CopilotChatProps } from "./CopilotChat";
import { CopilotChat } from "./CopilotChat";
import type { CopilotChatViewProps } from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import type { CopilotSidebarViewProps } from "./CopilotSidebarView";
import { CopilotSidebarView } from "./CopilotSidebarView";
import { ModalOpenControlProvider } from "./modal-open-control";
import { ModalThreadsScope } from "./modal-threads-drawer";

/**
 * Carries `threadsDrawer` to the sidebar's chatView override by context rather
 * than as a `useMemo` dependency of the override: an inline object prop is a
 * new value every render, and minting a new override component would remount
 * the whole chat subtree (see `ModalOpenControlProvider`).
 */
const SidebarThreadsDrawerContext =
  React.createContext<CopilotSidebarViewProps["threadsDrawer"]>(undefined);

export type CopilotSidebarProps = Omit<CopilotChatProps, "chatView"> & {
  header?: CopilotSidebarViewProps["header"];
  toggleButton?: CopilotSidebarViewProps["toggleButton"];
  defaultOpen?: boolean;
  /**
   * Controlled open state. When supplied, the host owns whether the sidebar is
   * open: the sidebar renders this value and never changes it on its own.
   * Pair it with `onOpenChange` to react to the toggle button. Omit it (and use
   * `defaultOpen`) to let the sidebar manage its own state.
   */
  open?: boolean;
  /**
   * Called with the requested state whenever the sidebar asks to open or close
   * (the toggle button, or the thread drawer on mobile). In controlled mode
   * nothing moves until the host updates `open`.
   */
  onOpenChange?: (open: boolean) => void;
  width?: number | string;
  position?: CopilotSidebarViewProps["position"];
  /**
   * Adds a threads drawer to the sidebar: a thread-list launcher in the header
   * opens it as a panel sliding in over the chat. Pass `true` for the default
   * drawer or an object of `CopilotThreadsDrawer` props to configure it.
   * Defaults to off. See `CopilotSidebarViewProps["threadsDrawer"]`.
   */
  threadsDrawer?: CopilotSidebarViewProps["threadsDrawer"];
};

export function CopilotSidebar({
  header,
  toggleButton,
  defaultOpen,
  open,
  onOpenChange,
  width,
  position,
  threadsDrawer,
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
        position: viewPosition,
        threadsDrawer: viewThreadsDrawer,
        ...restProps
      } = viewProps as CopilotSidebarViewProps;
      const contextThreadsDrawer = useContext(SidebarThreadsDrawerContext);

      return (
        <CopilotSidebarView
          {...(restProps as CopilotSidebarViewProps)}
          header={header ?? viewHeader}
          toggleButton={toggleButton ?? viewToggleButton}
          width={width ?? viewWidth}
          defaultOpen={defaultOpen ?? viewDefaultOpen}
          position={position ?? viewPosition}
          threadsDrawer={contextThreadsDrawer ?? viewThreadsDrawer}
        />
      );
    };

    return Object.assign(Component, CopilotChatView);
  }, [header, toggleButton, width, defaultOpen, position]);

  return (
    <>
      {!isSidebarLicensed && <InlineFeatureWarning featureName="Sidebar" />}
      {/*
        `open` / `onOpenChange` travel by context, not through
        SidebarViewOverride. The override is memoized on its own props, so a
        changing `open` would mint a new component identity on every toggle and
        remount the whole chat subtree.
      */}
      <ModalThreadsScope enabled={Boolean(threadsDrawer)}>
        <ModalOpenControlProvider open={open} onOpenChange={onOpenChange}>
          <SidebarThreadsDrawerContext.Provider value={threadsDrawer}>
            <CopilotChat
              welcomeScreen={CopilotSidebarView.WelcomeScreen}
              {...chatProps}
              isModalDefaultOpen={defaultOpen}
              chatView={SidebarViewOverride}
            />
          </SidebarThreadsDrawerContext.Provider>
        </ModalOpenControlProvider>
      </ModalThreadsScope>
    </>
  );
}

CopilotSidebar.displayName = "CopilotSidebar";

export default CopilotSidebar;
