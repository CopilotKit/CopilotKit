"use client";
import "./theme.css"; // side-effect import registers the .theme-vantage block

import type { ReactNode } from "react";
import Link from "next/link";
import { HelpCircle, RotateCcw } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useVantageHref, useVantageSegments } from "./href";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExecContext } from "./components/exec-context";
import { useAskCopilot } from "./components/use-ask-copilot";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_PX = 232;

const PAGE_LABELS: Record<string, string> = {
  "": "Boardroom",
  explore: "Explore",
  boards: "Boards",
  metrics: "Semantic layer",
};

export function VantageLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const vantageHref = useVantageHref();
  const segments = useVantageSegments();
  const { currentExec } = useExecContext();
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const Logo = skin.identity.logo;

  // Segments RELATIVE to the skin base — `[]` on the Boardroom, `["boards",
  // "<slug>"]` on a board. `useSkinSegments` strips a LEADING skin id rather
  // than slicing a fixed count, which is what makes this correct on a
  // `LOCK_SKIN=vantage` deploy: there the address bar carries no `/vantage`
  // prefix, and the old `pathname.split("/").slice(2)` would have eaten the
  // first REAL segment instead (`/explore` → `""`, so every nav entry reads as
  // inactive and the route readable claims the user is on the Boardroom).
  const rest = segments.join("/");
  const head = segments[0] ?? "";

  // THE ROUTE READABLE (beat 3b). Without this the agent has no idea which page
  // is open, so "what am I looking at?" returns the same answer everywhere and
  // the beat dies. Per-page readables (Task 12) describe what is ON each page;
  // this one says WHICH page.
  useAgentContext({
    description:
      "The page the user is currently looking at in the Vantage app, and the " +
      "acting executive. This IS your view of their screen — never claim you " +
      "cannot see it.",
    value: JSON.stringify({
      currentPage: PAGE_LABELS[head] ?? head,
      // The REAL address-bar path, built through the same builder every link
      // uses, so the agent can never read a URL out loud that the deploy does
      // not serve. Prefixed (`/vantage/explore`) on the multi-skin demo, which
      // is what the browser actually shows; prefix-free under a lock. It also
      // keeps this readable spelled the same way as the boards readables, which
      // have always emitted full paths.
      path: vantageHref(rest),
      availablePages: Object.values(PAGE_LABELS),
      actingExec: `${currentExec.name} (${currentExec.role})`,
    }),
  });

  const handleReset = async () => {
    if (
      !window.confirm("Reset demo state? This restores the seeded scenario.")
    ) {
      return;
    }
    try {
      const res = await fetch("/api/vantage/v1/dev/reset", { method: "POST" });
      if (res.ok) {
        // Hard navigate to the skin root for a pristine client slate (fresh
        // store, cleared canvas, new thread on next message) AND the clean
        // starting URL the demo should always open on — which is `/` itself on
        // a locked single-tenant deploy.
        window.location.assign(vantageHref());
      } else {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
      }
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    // h-full + overflow-hidden, NOT h-screen or any other viewport-height unit:
    // this chrome fills the shell's app CARD, which the frame has already
    // inset, so a viewport-height root would overflow that card by exactly the
    // frame's padding. It must stay BOUNDED — if this container can grow past
    // the card, the whole document scrolls, the pinned sidebar scrolls away
    // with it, and <main>'s own overflow-y-auto goes inert because its parent
    // is unbounded. Mirrors logistics' layout, where this bug was first fixed.
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-7 flex items-center gap-2.5 px-2 text-brand">
          <Logo className="h-6 w-6" />
          <span className="text-base font-bold tracking-tight text-ink">
            {skin.identity.brand}
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {skin.nav.map((route) => {
            const href = vantageHref(route.segment);
            const active = route.segment ? head === route.segment : head === "";
            const Icon = route.icon;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                {route.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          {/* Meta-utility strip: Reset (presenter-gated) and Help ONLY — no
           * theme toggle, deliberately, unlike the other skins' layouts.
           * Vantage is dark-locked (see theme.css's `--nw-theme-lock: dark`)
           * and ships no light palette, so a ThemeToggle here would be a dead
           * control with nothing to switch to. */}
          <TooltipProvider>
            <div className="flex items-center gap-1 border-t border-hairline px-1 pt-3">
              {resetEnabled && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleReset}
                      aria-label="Reset demo state"
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Reset demo state</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ask Vantage for help"
                    onClick={() =>
                      void askCopilot(
                        "What can you do for me in Vantage? Give me a short list.",
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Ask Vantage for help</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Acting exec — read-only in phase 1. Phase 2 turns this into the
              CFO/CRO/COO switcher that makes beat 4 a controlled experiment. */}
          <div className="flex items-center gap-2.5 rounded-[var(--radius)] border border-hairline bg-surface-muted p-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
              {currentExec.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-ink">
                {currentExec.name}
              </span>
              <span className="block text-[11px] text-ink-muted">
                {currentExec.role}
              </span>
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
