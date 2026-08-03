"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plane, Ticket, Award, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin, useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "./data/types";
import { PassengerHeader } from "./components/passenger-header";

// Side-effect import: loads the .theme-airline token block whenever the airline
// skin's chrome mounts. (The shell applies the `theme-airline` class higher up.)
import "./theme.css";

const NAV_ICONS: Record<string, typeof Plane> = {
  "": Ticket,
  loyalty: Award,
  disruptions: AlertTriangle,
};

/**
 * Aeronova app-shell chrome: a branded sidebar with nav + a passenger header,
 * and the page rendered in the main region. The shared chat panel and skin
 * selector are mounted by the shell, not here.
 */
export function AirlineLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const data = useSkinData<AirlineData>();
  const pathname = usePathname();
  const Logo = skin.identity.logo;

  // Publish this skin's edge-nav geometry so the shell's floating skin selector
  // can inset its dock clear of the nav WITHOUT the shell knowing anything about
  // airline (see `.nw-selector-dock` in globals.css). Aeronova pins a 256px
  // (w-64) sidebar to the LEFT of the content region and nothing to the right.
  // Published on <html> (like chat-panel's --nw-chat-width) so the fixed dock,
  // wherever it sits in the tree, inherits the values.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nw-nav-inset-left", "256px");
    root.style.setProperty("--nw-nav-inset-right", "0px");
    return () => {
      root.style.removeProperty("--nw-nav-inset-left");
      root.style.removeProperty("--nw-nav-inset-right");
    };
  }, []);

  return (
    <div className="flex h-full min-h-screen bg-canvas text-ink">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-hairline bg-surface px-4 py-6 md:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <span className="text-brand">
            <Logo className="h-7 w-7" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-bold text-ink">
              {skin.identity.brand}
            </div>
            <div className="text-[11px] text-ink-muted">Concierge</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {skin.nav.map((route) => {
            const href = route.segment
              ? `/${skin.id}/${route.segment}`
              : `/${skin.id}`;
            const active =
              pathname === href ||
              (route.segment === "" && pathname === `/${skin.id}`);
            const Icon = route.icon ?? NAV_ICONS[route.segment] ?? Plane;
            return (
              <Link
                key={route.segment || "index"}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" />
                {route.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-xl bg-surface-muted p-3 text-xs leading-relaxed text-ink-muted">
          Ask the concierge to check you in, pick a seat, or handle a delay.
        </div>
      </aside>

      {/* Main region */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-hairline bg-surface/80 px-5 py-4 backdrop-blur">
          <PassengerHeader passenger={data.passenger} flight={data.flight} />
        </header>
        <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
      </div>
    </div>
  );
}
