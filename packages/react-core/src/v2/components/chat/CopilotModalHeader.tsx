import React, { useCallback, useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "../../providers/CopilotChatConfigurationProvider";
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import { PanelLeftOpen, X } from "lucide-react";

type HeaderSlots = {
  titleContent: typeof CopilotModalHeader.Title;
  closeButton: typeof CopilotModalHeader.CloseButton;
  drawerLauncher: typeof CopilotModalHeader.DrawerLauncher;
};

type HeaderRestProps = {
  title?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">;

/**
 * Payload handed to the optional `children` render function. `drawerLauncher`
 * is nullable because the launcher is rendered only when a drawer has
 * registered — when none is present, custom layouts receive `null` and can omit
 * the launcher slot entirely.
 */
type HeaderChildrenPayload = {
  titleContent: React.ReactElement;
  closeButton: React.ReactElement;
  drawerLauncher: React.ReactElement | null;
  title?: string;
} & Omit<HeaderRestProps, "title">;

export type CopilotModalHeaderProps = Omit<
  WithSlots<HeaderSlots, HeaderRestProps>,
  "children"
> & {
  children?: (props: HeaderChildrenPayload) => React.ReactNode;
};

/**
 * Reactively tracks whether the viewport is in the mobile range (≤767px) — the
 * same breakpoint the drawer + chat coordination use. SSR-safe: starts `false`
 * (desktop) so the server render and first client render agree, then syncs on
 * mount and on resize.
 */
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export function CopilotModalHeader({
  title,
  titleContent,
  closeButton,
  drawerLauncher,
  children,
  className,
  ...rest
}: CopilotModalHeaderProps) {
  const configuration = useCopilotChatConfiguration();

  const fallbackTitle =
    configuration?.labels.modalHeaderTitle ??
    CopilotChatDefaultLabels.modalHeaderTitle;
  const resolvedTitle = title ?? fallbackTitle;

  // The thread-list launcher renders ONLY when a <CopilotThreadsDrawer> wrapper has
  // registered with the chat configuration AND the viewport is mobile. On
  // desktop the drawer is an in-flow, persistent panel (it ignores `open`), so
  // an "open the drawer" launcher there is a dead no-op — it only does anything
  // for the mobile off-canvas drawer. Chats with no drawer get no launcher and
  // no behavior change.
  const isMobile = useIsMobileViewport();
  const drawerRegistered =
    (configuration?.drawerRegistered ?? false) && isMobile;

  const handleClose = useCallback(() => {
    configuration?.setModalOpen?.(false);
  }, [configuration]);

  const handleToggleDrawer = useCallback(() => {
    configuration?.setDrawerOpen?.(!configuration.drawerOpen);
  }, [configuration]);

  const BoundTitle = renderSlot(titleContent, CopilotModalHeader.Title, {
    children: resolvedTitle,
  });

  const BoundCloseButton = renderSlot(
    closeButton,
    CopilotModalHeader.CloseButton,
    {
      onClick: handleClose,
    },
  );

  // Only bind the launcher slot when a drawer is registered. When no drawer is
  // present, `BoundDrawerLauncher` is null and nothing is rendered.
  const BoundDrawerLauncher = drawerRegistered
    ? renderSlot(drawerLauncher, CopilotModalHeader.DrawerLauncher, {
        onClick: handleToggleDrawer,
        "aria-expanded": configuration?.drawerOpen ?? false,
      })
    : null;

  if (children) {
    return children({
      titleContent: BoundTitle,
      closeButton: BoundCloseButton,
      drawerLauncher: BoundDrawerLauncher,
      title: resolvedTitle,
      ...rest,
    });
  }

  return (
    <header
      data-testid="copilot-modal-header"
      data-slot="copilot-modal-header"
      className={cn("copilotKitHeader cpk-modal-header", className)}
      {...rest}
    >
      <div className="cpk-modal-header-content">
        <div className="cpk-modal-header-start">
          {BoundDrawerLauncher ?? <span aria-hidden="true" />}
        </div>
        <div className="cpk-modal-header-center">{BoundTitle}</div>
        <div className="cpk-modal-header-end">{BoundCloseButton}</div>
      </div>
    </header>
  );
}

CopilotModalHeader.displayName = "CopilotModalHeader";

export namespace CopilotModalHeader {
  export const Title: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    children,
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-header-title"
      className={cn("cpk-modal-header-title", className)}
      {...props}
    >
      {children}
    </div>
  );

  /**
   * Closes the popup or sidebar. Its accessible name is
   * `labels.modalHeaderCloseButtonLabel`.
   */
  export const CloseButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <button
        type="button"
        data-testid="copilot-close-button"
        className={cn("cpk-modal-header-close-button", className)}
        aria-label={labels.modalHeaderCloseButtonLabel}
        {...props}
      >
        <X className="cpk-modal-header-close-icon" aria-hidden="true" />
      </button>
    );
  };

  /**
   * The thread-list launcher button. Rendered in the header ONLY when a
   * `<CopilotThreadsDrawer>` wrapper has registered with the chat configuration; it
   * toggles the drawer open state. The stable `data-testid` is the focus-return
   * target for the drawer wrapper on cancel/back/backdrop/Escape.
   */
  export const DrawerLauncher: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <button
        type="button"
        data-testid="copilot-threads-drawer-launcher"
        className={cn("cpk-modal-header-drawer-launcher", className)}
        aria-label={labels.modalHeaderThreadsButtonLabel}
        {...props}
      >
        <PanelLeftOpen
          className="cpk-modal-header-drawer-launcher-icon"
          aria-hidden="true"
        />
      </button>
    );
  };
}

CopilotModalHeader.Title.displayName = "CopilotModalHeader.Title";
CopilotModalHeader.CloseButton.displayName = "CopilotModalHeader.CloseButton";
CopilotModalHeader.DrawerLauncher.displayName =
  "CopilotModalHeader.DrawerLauncher";

export default CopilotModalHeader;
