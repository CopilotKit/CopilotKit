"use client";
import "./theme.css"; // side-effect import registers the .theme-commerce block

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
import { useCommerceLedger } from "./data/ledger-context";
import { describeError, resetLandedWrites } from "./settle";
import { useAskCopilot } from "./components/use-ask-copilot";
import { SkuTile } from "./components/sku-tile";

const SIDEBAR_WIDTH_PX = 240;

/**
 * The page each nav segment reports itself as to the agent. The index route is
 * `/commerce`, which IS the order book — reporting `""` there would tell the
 * agent "the current page is empty string", so it gets a real name.
 */
const ROUTE_READABLE_NAME: Record<string, string> = {
  "": "orders",
  catalog: "catalog",
  promotions: "promotions",
  returns: "returns",
};

const CONFIRM_RESET = "Reset the demo? This restores the seeded scenario.";

/**
 * The four things the reset needs from the browser, injected so the whole
 * sequence is testable without a document. `navigate` is a REAL document load
 * (`location.assign`), never a router push: the point is to drop every piece of
 * client state the reset invalidated, and a soft nav keeps all of it.
 */
export interface PresenterResetIo {
  confirm: (message: string) => boolean;
  notify: (message: string) => void;
  navigate: () => void;
  post: () => Promise<Response>;
}

/**
 * What the reset route's response says about THE SERVER STORE — the only
 * question this client has to answer, because `store.reset()` runs in the route
 * BEFORE anything that can fail and is never rolled back.
 *
 *  - `true`  — the body named the store in `reset`, so every row this document
 *              is holding is gone. True of the 200s AND of both 502s.
 *  - `false` — a body the route composed before it mutated anything (today only
 *              the 403 gate, which carries `error` and no `reset`), so the
 *              screen is still true and must be left alone.
 *  - `null`  — unreadable or unrecognised body: a Next-generated error page, a
 *              proxy, an empty 500. The store MAY be wiped and the client cannot
 *              tell, which is treated as wiped (see `runPresenterReset`).
 */
interface ResetVerdict {
  storeWiped: boolean | null;
  /** The route's presenter-facing memory sentence, or `""` if it sent none. */
  memoryError: string;
  /** The gate's own explanation, or `""`. Only used when the store is intact. */
  message: string;
}

async function readResetVerdict(res: Response): Promise<ResetVerdict> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const reset = body.reset;
    return {
      storeWiped: Array.isArray(reset)
        ? reset.includes("store")
        : typeof body.error === "string"
          ? // Refused, not attempted: the gate is the only response this route
            // composes without a `reset` list, and it returns before the wipe.
            false
          : null,
      memoryError: typeof body.memoryError === "string" ? body.memoryError : "",
      message: typeof body.message === "string" ? body.message : "",
    };
  } catch {
    // Not a swallowed error — this IS the "cannot tell" verdict, and the caller
    // acts on it. The parse failure itself says nothing a presenter can use.
    return { storeWiped: null, memoryError: "", message: "" };
  }
}

/**
 * The presenter/booth Reset, end to end.
 *
 * The rule it exists to enforce: **the moment the server store is (or may be)
 * wiped, nothing this document is holding may keep asserting the old world.**
 * There are two narrators, and a partial failure used to leave both of them
 * lying:
 *
 *  1. THE SCREEN. `store.reset()` is the route's first act, so a 502 (memory
 *     wiped but not fully re-seeded) and a mid-sweep throw BOTH mean the ledger
 *     is already back to seed. Branching on `res.ok` alone neither navigated nor
 *     refreshed on those paths, so the page went on rendering pre-reset rows —
 *     and the page is also what the agent's readables describe, so "what's on my
 *     screen?" described the vanished state too.
 *  2. THE AGENT'S RECITAL. `settle.ts`'s module-level journal of landed writes
 *     is dropped by a document load and by nothing else. No navigate meant the
 *     journal outlived the ledger, and the next failure on one of those records
 *     recited writes the reset had taken away as still standing.
 *
 * So every outcome except a PROVABLY untouched store ends the same way: clear
 * the journal, show the warning, hard navigate. The asymmetry is deliberate — a
 * needless reload costs a few seconds of stage time, while a stale page costs
 * the demo, and the presenter pressed Reset precisely to throw this state away.
 *
 * The warning is not decoration either: the 502's `memoryError` is the one
 * sentence that says beat 6 may start out ALREADY TAUGHT, which changes what the
 * presenter does next (run Reset again, or skip the teach beat). Reporting a
 * bare "HTTP 502" over the top of it threw that away.
 */
export async function runPresenterReset(io: PresenterResetIo): Promise<void> {
  if (!io.confirm(CONFIRM_RESET)) return;

  const leave = (warning: string) => {
    // Cleared EXPLICITLY as well as by the navigate below. Belt and braces on
    // purpose: the journal must be gone even if the document load never lands
    // (a modal left open, a `beforeunload`, a browser that refuses the assign),
    // because a surviving entry is a recital about records the reset emptied.
    resetLandedWrites();
    // Ordered. `notify` is modal, so the presenter reads it and THEN the page
    // goes away; reversed, the navigation can dismiss the only copy of the
    // sentence saying memory may still be dirty.
    if (warning) io.notify(warning);
    io.navigate();
  };

  let res: Response;
  try {
    res = await io.post();
  } catch (err) {
    // No response at all, so the store's state is unknowable — and this store is
    // in-memory, so the likeliest cause (the dev server restarting mid-call) has
    // itself already reset it. Reloading is the reading that cannot be wrong in
    // the demo-destroying direction; if the server really is gone the browser
    // says so, which the presenter has to know either way.
    leave(
      `Reset could not be confirmed: ${describeError(err)}. The demo data may ` +
        `already have been reset, so this page is reloading. If it does not come ` +
        `back, the server is down.`,
    );
    return;
  }

  const verdict = await readResetVerdict(res);

  if (verdict.storeWiped === false) {
    // Refused before it mutated anything. Nothing on screen is stale and the
    // journal is still true, so navigating would throw away a working demo.
    io.notify(
      `The demo was NOT reset (HTTP ${res.status}). ` +
        `${verdict.message || "See the server logs."} Nothing has changed.`,
    );
    return;
  }

  if (res.ok) {
    leave("");
    return;
  }

  leave(
    `Reset incomplete (HTTP ${res.status}). The demo data WAS reset, so this ` +
      `page is reloading. Memory was not: ` +
      `${verdict.memoryError || "see the server logs"}. Run Reset again before ` +
      `you present — the memory beats may otherwise start out already taught.`,
  );
}

export function CommerceLayout({ children }: { children: ReactNode }) {
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
  const { operator, data, setOperatorId } = useCommerceLedger();
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
      "The page the user is currently looking at in the Bellwether commerce " +
      "operations app.",
    value: ROUTE_READABLE_NAME[restHead] ?? restHead,
  });

  // Who is signed in — Bellwether scopes durable memory per operator, so the
  // agent should speak to the right person by name.
  useAgentContext({
    description: "The signed-in Bellwether operator.",
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

  const handleReset = () =>
    runPresenterReset({
      confirm: (message) => window.confirm(message),
      notify: (message) => window.alert(message),
      // Hard navigate to the skin root for a pristine slate — fresh store,
      // cleared canvas, new thread on the next message — and the clean starting
      // URL, which is `/` itself on a locked single-tenant deploy.
      navigate: () => window.location.assign(skinHref()),
      post: () => fetch("/api/commerce/v1/dev/reset", { method: "POST" }),
    });

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
              Commerce Ops
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
                  `--nw-dark-capable: 1` and ships a `.dark .theme-commerce`
                  block. */}
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ask Bellwether for help"
                    onClick={() =>
                      void askCopilot(
                        "What can you help me with in Bellwether? Give me a short list.",
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ask Bellwether for help</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* Who is signed in. Switching operator re-scopes Intelligence memory
              through `useRuntimeProperties`, which is the point: Nadia has
              taught Bellwether how she reads a margin review, Theo has taught it
              nothing. */}
          <div className="mt-3 flex items-center gap-2 rounded-md border border-hairline bg-surface-muted px-2 py-2">
            <SkuTile name={operator.name} size="sm" shape="round" />
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
