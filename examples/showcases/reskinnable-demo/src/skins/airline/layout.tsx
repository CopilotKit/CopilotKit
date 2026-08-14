"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Plane,
  Ticket,
  Award,
  AlertTriangle,
  UserRound,
  PlaneTakeoff,
  RotateCcw,
} from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { useConciergeView } from "./components/concierge-view";
import { PassengerHeader } from "./components/passenger-header";

// Side-effect import: loads the .theme-airline token block whenever the airline
// skin's chrome mounts. (The shell applies the `theme-airline` class higher up.)
import "./theme.css";

const NAV_ICONS: Record<string, typeof Plane> = {
  "": Ticket,
  account: UserRound,
  rebook: PlaneTakeoff,
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
  // The REST ledger, projected. `PassengerHeader` already tolerates a null
  // passenger and prints "waiting for context", which is what the first paint
  // shows before `GET /ledger` settles.
  const data = useConciergeView();
  const skinHref = useSkinHref(skin.id);
  const restHead = useSkinSegments(skin.id)[0] ?? "";
  const resetEnabled = usePresenterReset();
  const Logo = skin.identity.logo;

  // ── BEAT 3b, part 1 — the agent's view of WHICH page is open ─────────────
  // Airline shipped only GLOBAL readables before this, so "what's on my
  // screen?" answered identically everywhere — which reads as working right up
  // until the presenter navigates and asks a second time. That is the exact
  // failure demo-beats.md § 3b calls "most often broken by omission".
  //
  // `restHead` comes from `useSkinSegments`, NOT a hand-rolled
  // `pathname.split("/")[2]`. The manual form slices a FIXED offset, so it is
  // right only while the URL carries the skin prefix and reports the wrong page
  // on a LOCK_SKIN deploy — where the skin is served at `/` — while still
  // passing every test run against an unlocked dev server.
  useAgentContext({
    description:
      "The page the passenger is looking at right now, as a route segment. " +
      "An empty segment is the Trip page (the index).",
    value: restHead,
  });

  /**
   * PRESENTER RESET — restore the seeded trip record AND re-arm the memory beats.
   *
   * A HARD navigate to the skin root, not `router.refresh()`: the point is a
   * pristine client slate (fresh ledger read, cleared canvas, a new thread on the
   * next message) plus the clean starting URL the demo should always open on —
   * which is `/` itself on a locked single-tenant deploy, hence `skinHref()`
   * rather than a literal `/airline`.
   *
   * ⚠️ A NON-OK RESPONSE MUST NOT BE SWALLOWED. The route answers 502 when the
   * memory wipe could not prove it finished or the re-seed fell short, and BOTH
   * states break a beat silently: a surviving memory can leave beat 6 already
   * taught, and a short seed leaves beats 4/5 recalling nothing. So the alert
   * fires and the page is NOT reloaded — a presenter who sees a clean-looking app
   * assumes the reset worked.
   */
  const handleReset = async () => {
    if (
      !window.confirm("Reset demo state? This restores the seeded trip record.")
    ) {
      return;
    }
    try {
      const res = await fetch("/api/airline/v1/dev/reset", { method: "POST" });
      if (res.ok) {
        window.location.assign(skinHref());
      } else {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
      }
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    // `h-full`, not `min-h-screen`: this chrome now fills the shell's app card,
    // which is already inset by the frame padding — sizing to the viewport would
    // overflow the card by exactly that padding.
    <div className="flex h-full bg-canvas text-ink">
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
            const href = skinHref(route.segment);
            const active = restHead === route.segment;
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

        <div className="mt-auto flex flex-col gap-2">
          {/* Booth/presenter only — `PRESENTER_RESET_ENABLED`, read server-side in
              the root layout and threaded down as a boolean. Gated the same way
              the route is, so a production booth never shows a control that
              403s. */}
          {resetEnabled && (
            <button
              type="button"
              onClick={() => void handleReset()}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <RotateCcw className="h-4 w-4" />
              Reset demo
            </button>
          )}
          <div className="rounded-xl bg-surface-muted p-3 text-xs leading-relaxed text-ink-muted">
            Ask the concierge to check you in, pick a seat, or handle a delay.
          </div>
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
