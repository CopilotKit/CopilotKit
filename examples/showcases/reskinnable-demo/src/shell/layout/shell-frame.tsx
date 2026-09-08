"use client";

import { PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";

import {
  Panel,
  ResizableGroup,
  ResizableGutter,
  safeLayoutStorage,
  useDefaultLayout,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import {
  ASSISTANT_DEFAULT_PX,
  ASSISTANT_MAX,
  ASSISTANT_MIN_PX,
} from "./panel-sizes";
import { SelectorCard } from "./selector-card";
import { useIsDesktop } from "./use-is-desktop";
import { useLayoutPreferences } from "./layout-preferences";

/**
 * The inset app frame: a padded region in which the sidebar column (selector
 * card + chat card) and the skin's app each float as a rounded card, separated by
 * a resizable gutter.
 *
 * `chat` is the entire chat cluster including its own nested panel group — the
 * frame only positions it. `app` is the skin's own Layout wrapping the shared
 * canvas region, clipped to the app card.
 *
 * The selector and the chat form ONE logical sidebar: collapsing the sidebar
 * hides both, and the launcher restores both.
 */
export function ShellFrame({
  activeSkinId,
  chat,
  app,
}: {
  activeSkinId: string;
  chat: ReactNode;
  app: ReactNode;
}) {
  const { sidebarSide, sidebarOpen, setSidebarOpen } = useLayoutPreferences();
  const isDesktop = useIsDesktop();

  // A distinct saved layout per side. v4 has no `order` prop, so swapping sides
  // means reversing JSX order; keying the layout by side is what stops a
  // left-docked width from being restored as a mirrored right-docked one.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `nw-shell-${sidebarSide === "left" ? "ltr" : "rtl"}`,
    storage: safeLayoutStorage,
  });

  const sidebarColumn = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <SelectorCard activeId={activeSkinId} />
      <div className="nw-panel-card min-h-0 flex-1 border border-hairline bg-surface shadow-soft">
        {chat}
      </div>
    </div>
  );

  const appCard = (
    <div className="nw-panel-card h-full border border-hairline bg-surface shadow-soft">
      {app}
    </div>
  );

  // On small screens the columns become an overlay instead. This is a genuine
  // mobile branch, not a workaround for unsatisfiable constraints: 250px beside
  // 50% fits anything above the breakpoint.
  if (!isDesktop) {
    return (
      <div data-testid="shell-frame" className="h-screen bg-canvas">
        <div data-testid="app-panel" className="h-full">
          {app}
        </div>
        {sidebarOpen ? (
          <div className="fixed inset-0 z-[1200] flex flex-col gap-2 bg-canvas p-2">
            {sidebarColumn}
          </div>
        ) : (
          <SidebarLauncher onClick={() => setSidebarOpen(true)} />
        )}
      </div>
    );
  }

  if (!sidebarOpen) {
    return (
      <div
        data-testid="shell-frame"
        className="flex h-screen gap-2 bg-canvas p-2"
      >
        <div data-testid="app-panel" className="min-w-0 flex-1">
          {appCard}
        </div>
        <SidebarLauncher onClick={() => setSidebarOpen(true)} />
      </div>
    );
  }

  // `id` doubles as the emitted `data-testid` AND the persistence key: the
  // library derives `data-testid` from `id` and overwrites any passed in, so the
  // id IS the query handle (see resizable.test.tsx).
  // One bounded panel, one that takes the remainder. The rail is not a panel, so
  // nothing here compounds: these bounds hold whatever the rail is doing.
  const sidebarPanel = (
    <Panel
      key="sidebar-panel"
      id="sidebar-panel"
      minSize={ASSISTANT_MIN_PX}
      maxSize={ASSISTANT_MAX}
      defaultSize={ASSISTANT_DEFAULT_PX}
      className="h-full min-w-0"
    >
      {sidebarColumn}
    </Panel>
  );

  // No floor needed: capping the assistant at half the frame already guarantees
  // the app the other half.
  const appPanel = (
    <Panel key="app-panel" id="app-panel" className="h-full min-w-0">
      {appCard}
    </Panel>
  );

  return (
    <div data-testid="shell-frame" className="h-screen bg-canvas p-2">
      <ResizableGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {sidebarSide === "left" ? sidebarPanel : appPanel}
        <ResizableGutter />
        {sidebarSide === "left" ? appPanel : sidebarPanel}
      </ResizableGroup>
    </div>
  );
}

/**
 * Restores the collapsed sidebar. Because the selector collapses with the chat,
 * this is the only route back to the skin switcher — so it is pinned where the
 * sidebar itself would begin rather than tucked into a corner.
 */
function SidebarLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="sidebar-launcher"
      onClick={onClick}
      aria-label="Show assistant and skin selector"
      title="Show assistant and skin selector"
      className={cn(
        "fixed left-4 top-4 z-[1250] inline-flex h-9 w-9 items-center justify-center",
        "nw-panel-card border border-hairline bg-surface text-ink-muted shadow-soft",
        "transition-colors hover:text-ink",
      )}
    >
      <PanelLeftOpen className="h-[18px] w-[18px]" />
    </button>
  );
}

export default ShellFrame;
