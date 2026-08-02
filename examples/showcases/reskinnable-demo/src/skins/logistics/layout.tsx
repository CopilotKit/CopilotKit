"use client";
import "./theme.css"; // side-effect import registers the .theme-logistics block

import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSkin } from "@/shell/skin-provider";
import { usePlannerAuth } from "./components/planner-auth-context";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_PX = 240;

export function LogisticsLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const pathname = usePathname();
  const { currentPlanner, planners, setPlannerId } = usePlannerAuth();
  const Logo = skin.identity.logo;

  // Tell the shell how much width our nav reserves so the floating skin
  // selector docks in the content band and never lands on the sidebar.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nw-nav-inset-left", `${SIDEBAR_WIDTH_PX}px`);
    root.style.setProperty("--nw-nav-inset-right", "0px");
    return () => {
      root.style.removeProperty("--nw-nav-inset-left");
      root.style.removeProperty("--nw-nav-inset-right");
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside
        className="hidden shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
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

        {/* Role switcher — swapping to the Director is what visibly lifts the
            authority gate, so it belongs in the always-visible chrome. */}
        <div className="mt-auto rounded-md border border-hairline bg-surface-muted p-3">
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
      </aside>

      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
