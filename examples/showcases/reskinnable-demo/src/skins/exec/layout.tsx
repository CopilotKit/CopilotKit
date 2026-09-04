"use client";
import "./theme.css"; // side-effect import registers the .theme-exec block

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  useAgent,
  useAgentContext,
  useCopilotChatConfiguration,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
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
import { ResetDemoError, useExecLedger } from "./data/ledger-context";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_PX = 240;

export function ExecLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const skinHref = useSkinHref("exec");
  const restHead = useSkinSegments("exec")[0] ?? "";
  const resetEnabled = usePresenterReset();
  const { resetDemo } = useExecLedger();
  const Logo = skin.identity.logo;

  // Ask-the-copilot for the sidebar Help control below. PORTED, not imported,
  // from logistics'/people's own components/use-ask-copilot.ts: a skin's only
  // inbound dependency is the shell's Skin contract, so this stays local
  // rather than reaching into another skin's folder for a hook this small.
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const configuration = useCopilotChatConfiguration();
  const setModalOpen = configuration?.setModalOpen;
  // The chrome's own error line. `askCopilot` posts a USER turn into the thread
  // before it runs, so a rejected run leaves that turn sitting there with
  // nothing ever coming back — indistinguishable, on stage, from a model that
  // is merely slow. A console line does not reach the operator; this does.
  // Mirrors the ledger provider's dismissible stale-view banner
  // (`data-testid="ledger-refresh-error"` in `./data/ledger-context.tsx`).
  const [chromeError, setChromeError] = useState<string | null>(null);
  const askCopilot = useCallback(
    async (message: string) => {
      setModalOpen?.(true);
      setChromeError(null);
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: message,
      });
      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("askCopilot: runAgent failed", error);
        setChromeError(
          `The copilot could not answer that: ${
            error instanceof Error ? error.message : String(error)
          }. Your message is still in the thread — try again.`,
        );
      }
    },
    [agent, copilotkit, setModalOpen],
  );

  // ── BEAT 3b, part 1 — the agent's view of WHICH page is open ─────────────
  // Without this the skin has only GLOBAL readables and answers "what's on my
  // screen?" identically everywhere, which reads as working right up until the
  // presenter navigates and asks twice. `restHead` comes from useSkinSegments,
  // which strips a LEADING skin id rather than slicing a fixed offset, so it is
  // correct whether or not the pathname carries the prefix (LOCK_SKIN serves the
  // locked skin at `/`, with no segment to slice off).
  useAgentContext({
    description:
      "The page the exec is looking at right now, as a route segment. " +
      "An empty segment is the CEO dashboard (the index).",
    value: restHead,
  });

  /**
   * IN-FLIGHT GUARD for the Reset control.
   *
   * `POST /api/exec/v1/dev/reset` is a long, NON-IDEMPOTENT round trip: it
   * wipes durable memory across every bucket and then re-seeds beats 4/5. The
   * button gave no sign it was working, so a presenter who saw nothing happen
   * pressed it again — and the second request's sweep deleted the rows the
   * first request had just seeded. Whether beats 4/5 end up armed then depends
   * on which fetch lands last, and nothing on screen says which way it went.
   *
   * Per-request timeouts (`intelligence/forget-memories.ts`,
   * `intelligence/seed-memories.ts`) bound each hop but cannot help here — the
   * requests are healthy, there are just two of them. There is no OVERALL
   * deadline on the round trip either; if one is ever wanted it belongs on the
   * route, which is the only place that knows how many buckets it is about to
   * walk. This state is the narrower fix for the double-press specifically.
   */
  const [resetting, setResetting] = useState(false);
  const handleReset = async () => {
    // Belt and braces with the `disabled` attribute below: a keyboard repeat
    // or a programmatic click must not get a second request in either.
    if (resetting) return;
    if (
      !window.confirm("Reset demo state? This restores the seeded scenario.")
    ) {
      return;
    }
    setResetting(true);
    try {
      await resetDemo();
      // Hard navigate to the skin root for a pristine client slate (fresh
      // store, cleared canvas, new thread on next message) AND the clean
      // starting URL the demo should always open on — which is `/` itself on
      // a locked single-tenant deploy.
      // Deliberately NOT re-enabled: this navigation is already under way, and
      // a control that comes back to life for the half-second before the page
      // unloads is an invitation to press it one more time.
      window.location.assign(skinHref());
    } catch (err) {
      // Every arm below returns without navigating, so the control has to come
      // back — otherwise a failed reset leaves the presenter no way to retry.
      setResetting(false);
      // ALWAYS logged. The alert below is modal and gone the moment it is
      // dismissed, so without this a refused or half-finished reset leaves no
      // trace at all to correlate against the server logs it points at.
      console.error("[exec] reset demo failed", err);
      // The 403 gate: `POST /api/exec/v1/dev/reset` answers
      // `{ error: "FORBIDDEN" }` when presenter reset is not enabled, BEFORE
      // it touches the store — so nothing was reset and "Reset failed" sends
      // the presenter hunting a bug instead of a flag. Matched tolerantly (the
      // body's `error` OR the status carried in the message) so a change to
      // either half of `resetDemo`'s contract degrades to the generic arm
      // rather than mis-reporting this one.
      const body = err instanceof ResetDemoError ? err.body : null;
      const forbidden =
        // A `reset` array means the store DID reset (the route's first act
        // after the gate), so it can never be the refusal — checked first so
        // the partial-reset arm below always wins that overlap.
        !Array.isArray(body?.reset) &&
        (String(body?.error ?? "").toUpperCase() === "FORBIDDEN" ||
          (err instanceof ResetDemoError && /\b403\b/.test(err.message)));
      if (forbidden) {
        window.alert(
          "Demo reset is not enabled on this deployment, so nothing was " +
            "changed. The server refused the request (403 FORBIDDEN) — set " +
            "the presenter-reset flag and restart to enable it.",
        );
        return;
      }
      // A 502 from `dev/reset` means the STORE half already reset (it is the
      // route's first act) and only durable memory fell short — `resetDemo`
      // already best-effort refreshed for that case, so this alert must say
      // so rather than a bare "Reset failed", which reads as though nothing
      // happened and invites re-pressing a button that already did its job.
      if (err instanceof ResetDemoError && Array.isArray(err.body?.reset)) {
        const { seeded, expectedSeeds, memoryError } = err.body as {
          seeded?: unknown;
          expectedSeeds?: unknown;
          memoryError?: unknown;
        };
        const progress =
          typeof seeded === "number" && typeof expectedSeeds === "number"
            ? ` (${seeded}/${expectedSeeds} memories seeded)`
            : "";
        const detail =
          typeof memoryError === "string" ? `: ${memoryError}` : "";
        window.alert(
          `Demo data was reset, but memory seeding failed${progress}${detail}. ` +
            `Beats 4-6 may not be armed — see the server logs, then reset again.`,
        );
        return;
      }
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    // h-full + overflow-hidden (not min-h-*): this chrome must be exactly as tall
    // as the shell's app CARD so the nav stays pinned and <main> scrolls INSIDE
    // it. If the container grows past the card on a long page, the whole document
    // scrolls — taking the nav with it — and <main>'s own overflow-y-auto goes
    // inert because its parent is unbounded. Mirrors logistics'/banking's layout.
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
            const href = skinHref(route.segment);
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

        {/* Meta-utility strip — Reset (presenter-gated), theme toggle, and a
            copilot Help shortcut. Semantic utilities only, so a reskin swaps
            the palette without touching this chrome. Exec has a single
            persona — unlike logistics' planner switcher, there is no
            role-switcher block stacked below it. */}
        <div className="mt-auto">
          <TooltipProvider>
            <div className="flex items-center gap-1 border-t border-hairline px-1 pt-3">
              {resetEnabled && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void handleReset()}
                      disabled={resetting}
                      aria-busy={resetting}
                      aria-label="Reset demo state"
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                        resetting
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-brand-soft hover:text-brand",
                      )}
                    >
                      {/* Spinning while the round trip is out: the absence of
                          any feedback at all is what got the button pressed
                          twice in the first place. */}
                      <RotateCcw
                        className={cn(
                          "h-4 w-4",
                          resetting &&
                            "animate-spin [animation-direction:reverse]",
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{resetting ? "Resetting…" : "Reset demo state"}</p>
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
                        "What can you help me with on this executive dashboard? Give me a short list.",
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
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-5 py-6">
        {chromeError && (
          <div
            data-testid="exec-chrome-error"
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-md border border-negative bg-negative-soft px-3 py-2 text-xs text-negative"
          >
            <span>{chromeError}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              className="shrink-0 rounded-full border border-hairline bg-surface px-2 py-0.5 text-ink-muted transition hover:bg-surface-muted hover:text-ink"
              onClick={() => setChromeError(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
