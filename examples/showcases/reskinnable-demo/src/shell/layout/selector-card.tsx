"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, ChevronsUpDown, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { allSkins } from "@/shell/registry";
import { useSkinThemeReconcile } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { useLayoutPreferences } from "./layout-preferences";

/**
 * The top card of the assistant column, and the home of every SHELL control: which
 * skin is mounted, which side the assistant sits on, and whether it is showing at
 * all.
 *
 * All three are about the shell rather than the conversation, which is why they sit
 * here rather than in the chat header among the thread and message actions. Hiding
 * in particular collapses this whole column — the selector included — so putting it
 * beside the thing it hides reads better than burying it next to "new conversation".
 *
 * The skin switcher is a dropdown rather than a row of pills. Pills wrapped to more
 * rows with every skin added — at four they already took three rows in a 600px
 * column, stealing height from the conversation — so the trigger now shows only the
 * active skin and the list scrolls. Cost stays flat as skins are added.
 *
 * The ref must stay inside the skin's theme root: `useSkinThemeReconcile` reads the
 * computed `--nw-dark-capable` from it, and without that a light-only skin inherits
 * dark chat chrome from a dark-capable one.
 *
 * The menu portals to `<body>`; `globals.css` already lifts every Radix popper to
 * z-index 1300, so it layers above the frame's cards without extra rules.
 */
export function SelectorCard({ activeId }: { activeId: string }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  useSkinThemeReconcile(rootRef);
  const { sidebarSide, toggleSidebarSide, setSidebarOpen } =
    useLayoutPreferences();

  const skins = allSkins();
  // Fall back to the first registered skin rather than crashing: `activeId` comes
  // from the route, and an unknown segment 404s upstream, but this keeps a stray
  // render harmless.
  const active = skins.find((skin) => skin.id === activeId) ?? skins[0];
  const ActiveLogo = active.identity.logo;

  return (
    <div
      ref={rootRef}
      data-testid="skin-selector"
      className="nw-panel-card flex shrink-0 items-stretch border border-hairline bg-surface shadow-soft"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="skin-selector-trigger"
            aria-label={`Switch skin — currently ${active.identity.brand}`}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted"
          >
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-brand-soft text-brand">
              <ActiveLogo className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-ink">
                {active.identity.brand}
              </span>
              <span className="block truncate text-[11px] text-ink-muted">
                {active.identity.tagline}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 flex-none text-ink-muted" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          // Match the trigger's width, and scroll rather than grow once there are
          // more skins than fit — this is the point of the dropdown.
          className="max-h-[min(60vh,22rem)] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {skins.map((skin) => {
            const Logo = skin.identity.logo;
            const isActive = skin.id === activeId;
            return (
              <DropdownMenuItem
                key={skin.id}
                data-testid={`skin-option-${skin.id}`}
                aria-current={isActive ? "page" : undefined}
                onSelect={() => router.push(`/${skin.id}`)}
                className="gap-2.5 py-2"
              >
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-surface-muted text-ink">
                  <Logo className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium text-ink">
                    {skin.identity.brand}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {skin.identity.tagline}
                  </span>
                </span>
                <Check
                  className={cn(
                    "h-4 w-4 flex-none text-brand",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        data-testid="swap-sides"
        onClick={toggleSidebarSide}
        aria-label={
          sidebarSide === "left"
            ? "Move assistant to the right"
            : "Move assistant to the left"
        }
        title={
          sidebarSide === "left"
            ? "Move assistant to the right"
            : "Move assistant to the left"
        }
        className="flex w-11 flex-none items-center justify-center border-l border-hairline text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <ArrowLeftRight className="h-4 w-4" />
      </button>

      <button
        type="button"
        data-testid="sidebar-close"
        onClick={() => setSidebarOpen(false)}
        aria-label="Hide assistant"
        title="Hide assistant"
        className="flex w-11 flex-none items-center justify-center border-l border-hairline text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default SelectorCard;
