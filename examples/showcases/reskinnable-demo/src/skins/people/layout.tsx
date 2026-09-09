"use client";
import "./theme.css"; // side-effect import registers the .theme-people block

import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HelpCircle, RotateCcw } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { useCanvas } from "@/shell/canvas/canvas-context";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePeopleLedger } from "./data/ledger-context";
import { useAskCopilot } from "./components/use-ask-copilot";
import { Monogram } from "./components/monogram";

const SIDEBAR_WIDTH_PX = 240;

/**
 * The page each nav segment reports itself as to the agent. The index route is
 * `/people`, which IS the roster — reporting `""` there would tell the agent
 * "the current page is empty string", so it gets a real name.
 */
const ROUTE_READABLE_NAME: Record<string, string> = {
  "": "roster",
  compensation: "compensation",
  requests: "requests",
  onboarding: "onboarding",
};

export function PeopleLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  // EVERY in-skin link goes through skinHref — never a hardcoded `/${skin.id}/…`.
  // Under LOCK_SKIN the deploy is served AT `/` with the skin segment absent
  // from the URL space, and a hardcoded prefix would put it straight back into
  // the address bar on the first nav click. `pnpm lint` enforces this.
  const skinHref = useSkinHref(skin.id);
  // useSkinSegments strips a LEADING skin id if present, so this is correct
  // whether or not the pathname carries the prefix. Do NOT hand-roll it as
  // `pathname.split("/").slice(2)` — that eats the first real segment on a
  // locked deploy, where there is no prefix to skip.
  const restHead = useSkinSegments(skin.id)[0] ?? "";
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const { operator, data, setOperatorId } = usePeopleLedger();
  const { clear } = useCanvas();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const Logo = skin.identity.logo;

  // ── BEAT 3b: THE ROUTE READABLE ──────────────────────────────────────────
  // Without this the agent has no idea which page is open, so "what's on my
  // screen?" answers identically everywhere and the beat dies silently — the
  // answers are plausible, just not page-specific. Each PAGE registers its own
  // readable for what is visibly rendered; this one only says WHERE the user is.
  useAgentContext({
    description:
      "The page the user is currently looking at in the Rowan People Ops app.",
    value: ROUTE_READABLE_NAME[restHead] ?? restHead,
  });

  // Who is signed in — Rowan scopes durable memory per operator, so the agent
  // should speak to the right person by name.
  useAgentContext({
    description: "The signed-in Rowan operator.",
    value: JSON.stringify({
      id: operator.id,
      name: operator.name,
      role: operator.role,
      team: operator.team,
    }),
  });

  // Dismiss a canvas surface when the user navigates away, including a
  // query-string-only change (beat 3c pushes `?status=…&sort=…`, which is a nav
  // as far as the user is concerned but would otherwise leave a stale brief
  // covering the page they just asked to see).
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  const handleReset = async () => {
    if (!window.confirm("Reset the demo? This restores the seeded scenario.")) {
      return;
    }
    try {
      const res = await fetch("/api/people/v1/dev/reset", { method: "POST" });
      if (res.ok) {
        // Hard navigate to the skin root for a pristine slate — fresh store,
        // cleared canvas, new thread on the next message — and the clean
        // starting URL, which is `/` itself on a locked single-tenant deploy.
        window.location.assign(skinHref());
      } else {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
      }
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    // h-full + overflow-hidden — NOT h-screen, NOT min-h-screen. This chrome
    // fills the shell's app CARD, which the frame has already inset by its own
    // padding, so a viewport-height root overflows the card by exactly that
    // much. It must still be BOUNDED: an unbounded container scrolls the whole
    // document, taking the pinned nav with it and rendering <main>'s own
    // overflow-y-auto inert.
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo className="h-7 w-7 text-brand" />
          <div className="min-w-0">
            <div className="truncate text-base font-semibold tracking-tight text-ink">
              {skin.identity.brand}
            </div>
            <div className="truncate text-[0.68rem] text-ink-muted">
              People Ops
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {skin.nav.map((route) => {
            const href = skinHref(route.segment);
            // Compare SEGMENTS, not whole pathnames: under a lock the href is
            // prefix-free while the matched route is not, so `pathname === href`
            // is not reliably true for the active entry.
            const active = restHead === route.segment;
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

        {/* Meta-utility strip — skin-authored chrome, pinned to the bottom. A
            new skin gets none of these for free; the shell provides no Reset,
            no theme toggle and no Help. */}
        <div className="mt-auto">
          <TooltipProvider delayDuration={200}>
            <div className="flex items-center gap-1 border-t border-hairline px-1 pt-3">
              {resetEnabled ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void handleReset()}
                      aria-label="Reset demo state"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Reset demo state</TooltipContent>
                </Tooltip>
              ) : null}
              {/* A real control here, not a dead one: theme.css sets
                  `--nw-dark-capable: 1` and ships a `.dark .theme-people` block. */}
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ask Rowan for help"
                    onClick={() =>
                      void askCopilot(
                        "What can you help me with in Rowan? Give me a short list.",
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ask Rowan for help</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Who is signed in. Switching operator re-scopes Intelligence memory
              through `useRuntimeProperties`, which is the point: Maya has taught
              Rowan how she likes comp reviews, Clara has taught it nothing. */}
          <div className="mt-3 flex items-center gap-2 rounded-md border border-hairline bg-surface-muted px-2 py-2">
            <Monogram name={operator.name} size="sm" />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Signed in as</span>
              <select
                value={operator.id}
                onChange={(event) => setOperatorId(event.target.value)}
                className="w-full cursor-pointer truncate bg-transparent text-[0.75rem] font-medium text-ink outline-none"
              >
                {data.operators.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <span className="block truncate text-[0.65rem] text-ink-muted">
                {operator.team}
              </span>
            </label>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
    </div>
  );
}
