"use client";
import "./theme.css"; // side-effect import registers the .theme-logistics block

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, RotateCcw } from "lucide-react";
import { useSkin } from "@/shell/skin-provider";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlannerAuth } from "./components/planner-auth-context";
import { useAskCopilot } from "./components/use-ask-copilot";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_PX = 240;

export function LogisticsLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const pathname = usePathname();
  const { currentPlanner, planners, setPlannerId } = usePlannerAuth();
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const Logo = skin.identity.logo;

  const handleReset = async () => {
    if (
      !window.confirm("Reset demo state? This restores the seeded scenario.")
    ) {
      return;
    }
    try {
      const res = await fetch("/api/logistics/v1/dev/reset", {
        method: "POST",
      });
      if (res.ok) {
        // Hard navigate to the skin root for a pristine client slate (fresh
        // store, cleared canvas, new thread on next message) AND the clean
        // starting URL the demo should always open on.
        window.location.assign(`/${skin.id}`);
      } else {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
      }
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    // h-full + overflow-hidden (not min-h-*): this chrome must be exactly as tall
    // as the shell's app CARD so the nav stays pinned and <main> scrolls INSIDE
    // it. If the container grows past the card on a long page, the whole document
    // scrolls — taking the nav with it — and <main>'s own overflow-y-auto goes
    // inert because its parent is unbounded. Mirrors banking's layout.
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-7 flex items-center gap-2.5 px-2 text-brand">
          <Logo className="h-7 w-7" />
          <span className="text-base font-bold tracking-tight text-ink">
            {skin.identity.brand}
          </span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {skin.nav.map((route) => {
            const href = route.segment
              ? `/${skin.id}/${route.segment}`
              : `/${skin.id}`;
            const active = pathname === href;
            const Icon = route.icon;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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

        {/* Bottom group: meta-utility strip stacked directly above the
            always-visible "On duty" planner switcher. */}
        <div className="mt-auto flex flex-col gap-3">
          {/* Meta-utility strip — Reset (presenter-gated), theme toggle, and a
              copilot Help shortcut. Semantic utilities only, so a reskin swaps
              the palette without touching this chrome. */}
          <TooltipProvider>
            <div className="flex items-center gap-1 border-t border-hairline px-1 pt-3">
              {resetEnabled && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleReset}
                      aria-label="Reset demo state"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
                  <span>
                    <ThemeToggle />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Toggle theme</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ask the copilot for help"
                    onClick={() =>
                      void askCopilot(
                        "What can you help me with in this control tower? Give me a short list.",
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Ask the copilot for help</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Role switcher — swapping to the Director is what visibly lifts the
              authority gate, so it belongs in the always-visible chrome. */}
          <div className="rounded-md border border-hairline bg-surface-muted p-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              On duty
            </div>
            <select
              aria-label="Acting planner"
              className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink"
              value={currentPlanner.id}
              onChange={(e) => setPlannerId(e.target.value)}
            >
              {planners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.role}
                </option>
              ))}
            </select>
            <div className="mt-1.5 text-[11px] text-ink-muted">
              {currentPlanner.authorityUsd === null
                ? "Unlimited approval authority"
                : `Approves up to $${currentPlanner.authorityUsd.toLocaleString("en-US")}`}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
