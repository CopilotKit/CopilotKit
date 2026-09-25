import React, { useContext, useEffect, useMemo } from "react";
import { useLicenseContext } from "../../providers/CopilotKitProvider";
import {
  InlineFeatureWarning,
  shouldShowFeatureLicenseWarning,
} from "../license-warning-banner";

import type { CopilotChatProps } from "./CopilotChat";
import { CopilotChat } from "./CopilotChat";
import type { CopilotChatViewProps } from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import type { CopilotSidebarViewProps } from "./CopilotSidebarView";
import { CopilotSidebarView } from "./CopilotSidebarView";
import { ModalOpenControlProvider } from "./modal-open-control";

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
};

type SidebarShellProps = Pick<
  CopilotSidebarProps,
  "header" | "toggleButton" | "defaultOpen" | "width" | "position"
>;

const SidebarShellPropsContext = React.createContext<SidebarShellProps>({});

// Keep the chat view's component identity stable when shell props change.
// Otherwise a parent rerender (including one after approval settlement)
// unmounts the view while an agent run may still be active.
const SidebarViewOverride: React.FC<CopilotChatViewProps> = (viewProps) => {
  const {
    header: viewHeader,
    toggleButton: viewToggleButton,
    width: viewWidth,
    defaultOpen: viewDefaultOpen,
    position: viewPosition,
    ...restProps
  } = viewProps as CopilotSidebarViewProps;
  const shell = useContext(SidebarShellPropsContext);

  return (
    <CopilotSidebarView
      {...(restProps as CopilotSidebarViewProps)}
      header={shell.header ?? viewHeader}
      toggleButton={shell.toggleButton ?? viewToggleButton}
      width={shell.width ?? viewWidth}
      defaultOpen={shell.defaultOpen ?? viewDefaultOpen}
      position={shell.position ?? viewPosition}
    />
  );
};

const SidebarViewOverrideWithStatics = Object.assign(
  SidebarViewOverride,
  CopilotChatView,
) as typeof CopilotChatView;

export function CopilotSidebar({
  header,
  toggleButton,
  defaultOpen,
  open,
  onOpenChange,
  width,
  position,
  ...chatProps
}: CopilotSidebarProps) {
  const { checkFeature, status } = useLicenseContext();
  const isSidebarLicensed = checkFeature("sidebar");
  const showLicenseWarning = shouldShowFeatureLicenseWarning(
    isSidebarLicensed,
    status,
  );

  useEffect(() => {
    if (showLicenseWarning) {
      console.warn(
        '[CopilotKit] Warning: "sidebar" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  }, [showLicenseWarning]);

  const shellProps = useMemo<SidebarShellProps>(
    () => ({ header, toggleButton, defaultOpen, width, position }),
    [header, toggleButton, defaultOpen, width, position],
  );

  return (
    <>
      {showLicenseWarning && <InlineFeatureWarning featureName="Sidebar" />}
      {/*
        `open` / `onOpenChange` travel by context, not through
        SidebarViewOverride. The override is memoized on its own props, so a
        changing `open` would mint a new component identity on every toggle and
        remount the whole chat subtree.
      */}
      <SidebarShellPropsContext.Provider value={shellProps}>
        <ModalOpenControlProvider open={open} onOpenChange={onOpenChange}>
          <CopilotChat
            welcomeScreen={CopilotSidebarView.WelcomeScreen}
            {...chatProps}
            isModalDefaultOpen={defaultOpen}
            chatView={SidebarViewOverrideWithStatics}
          />
        </ModalOpenControlProvider>
      </SidebarShellPropsContext.Provider>
    </>
  );
}

CopilotSidebar.displayName = "CopilotSidebar";

export default CopilotSidebar;
