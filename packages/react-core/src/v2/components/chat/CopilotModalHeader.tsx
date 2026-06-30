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
      className={cn(
        "copilotKitHeader",
        "cpk:flex cpk:items-center cpk:justify-between cpk:border-b cpk:border-border cpk:px-4 cpk:py-4",
        "cpk:bg-background/95 cpk:backdrop-blur cpk:supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      {...rest}
    >
      <div className="cpk:flex cpk:w-full cpk:items-center cpk:gap-2">
        <div className="cpk:flex cpk:flex-1 cpk:justify-start">
          {BoundDrawerLauncher ?? <span aria-hidden="true" />}
        </div>
        <div className="cpk:flex cpk:flex-1 cpk:justify-center cpk:text-center">
          {BoundTitle}
        </div>
        <div className="cpk:flex cpk:flex-1 cpk:justify-end">
          {BoundCloseButton}
        </div>
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
      className={cn(
        "cpk:w-full cpk:text-base cpk:font-medium cpk:leading-none cpk:tracking-tight cpk:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  export const CloseButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, ...props }) => (
    <button
      type="button"
      data-testid="copilot-close-button"
      className={cn(
        "cpk:inline-flex cpk:size-8 cpk:items-center cpk:justify-center cpk:rounded-full cpk:text-muted-foreground cpk:transition cpk:cursor-pointer",
        "cpk:hover:bg-muted cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
        className,
      )}
      aria-label="Close"
      {...props}
    >
      <X className="cpk:h-4 cpk:w-4" aria-hidden="true" />
    </button>
  );

  /**
   * The thread-list launcher button. Rendered in the header ONLY when a
   * `<CopilotThreadsDrawer>` wrapper has registered with the chat configuration; it
   * toggles the drawer open state. The stable `data-testid` is the focus-return
   * target for the drawer wrapper on cancel/back/backdrop/Escape.
   */
  export const DrawerLauncher: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, ...props }) => (
    <button
      type="button"
      data-testid="copilot-threads-drawer-launcher"
      className={cn(
        "cpk:inline-flex cpk:size-8 cpk:items-center cpk:justify-center cpk:rounded-full cpk:text-muted-foreground cpk:transition cpk:cursor-pointer",
        "cpk:hover:bg-muted cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
        className,
      )}
      aria-label="Open threads"
      {...props}
    >
      <PanelLeftOpen className="cpk:h-4 cpk:w-4" aria-hidden="true" />
    </button>
  );
}

CopilotModalHeader.Title.displayName = "CopilotModalHeader.Title";
CopilotModalHeader.CloseButton.displayName = "CopilotModalHeader.CloseButton";
CopilotModalHeader.DrawerLauncher.displayName =
  "CopilotModalHeader.DrawerLauncher";

export default CopilotModalHeader;
