"use client";
import "./theme.css"; // side-effect import registers the .theme-bookstore block

import type { ReactNode } from "react";
import Link from "next/link";
import { HelpCircle, RotateCcw, ShoppingBag } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin, useSkinData } from "@/shell/skin-provider";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useShopper } from "@/skins/bookstore/providers";
import { useBookstoreHref, useBookstoreSegments } from "@/skins/bookstore/href";
import { cartTotals } from "@/skins/bookstore/data/query";
import {
  cartStorageKey,
  ordersStorageKey,
} from "@/skins/bookstore/data/use-data";
import type { BookstoreData } from "@/skins/bookstore/data/types";
import { useAskCopilot } from "./components/use-ask-copilot";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_PX = 220;

/**
 * What each URL segment reports itself as to the agent. The index route IS the
 * shelf, so `""` gets the real name `browse` — telling the agent "the current
 * page is empty string" is worse than telling it nothing.
 *
 * `book` covers the parameterized detail route `book/<slug>`: only the HEAD
 * segment is looked up here, so every slug lands on the same page name.
 */
const ROUTE_READABLE_NAME: Record<string, string> = {
  "": "browse",
  browse: "browse",
  book: "book",
  cart: "cart",
};

export function BookstoreLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  // EVERY in-skin link goes through skinHref — never a hardcoded
  // `/${skin.id}/…`. Under LOCK_SKIN the deploy is served AT `/` with the skin
  // segment absent from the URL space, and a hardcoded prefix would put it
  // straight back in the address bar on the first nav click. `pnpm lint`
  // enforces this with a `no-restricted-syntax` guard.
  const skinHref = useBookstoreHref();
  // useSkinSegments strips a LEADING skin id if present, so this is correct
  // whether or not the pathname carries the prefix. Do NOT hand-roll it as
  // `pathname.split("/").slice(2)` — that eats the first real segment on a
  // locked deploy, where there is no prefix to skip, and would report "browse"
  // while the shopper is standing on the cart page.
  const restHead = useBookstoreSegments()[0] ?? "";
  // Read through the shell, never `useBookstoreData()` directly: the store is
  // created per `useMemo` instance, so a second call site would mint a
  // DIVERGENT store whose writes this chrome never sees (a nav badge that
  // never moves while the cart page fills up).
  const data = useSkinData<BookstoreData>();
  const { shopper, shoppers, setShopperId } = useShopper();
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const Logo = skin.identity.logo;

  const { itemCount } = cartTotals(data.books, data.cart);

  // ── THE ROUTE READABLE ────────────────────────────────────────────────────
  // Without this the agent has no idea which page is open and answers "what's on
  // my screen?" identically everywhere — which is why that beat is impossible in
  // three of the five shipped skins. The per-page readables describe what is
  // visibly ON the page; this one names the page itself.
  useAgentContext({
    description:
      "The page the shopper is currently viewing in the store: 'browse' (the shelf), 'book' (a single book's detail page), or 'cart'.",
    value: ROUTE_READABLE_NAME[restHead] ?? restHead,
  });

  const handleReset = async () => {
    if (
      !window.confirm(
        "Reset demo state? This clears the cart and orders, and re-seeds the shopper's memory.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/bookstore/v1/dev/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The scope must be EXPLICIT: the route has no client context to infer
        // whose memory to clear, and clearing the wrong shopper would leave the
        // demo looking reset while the seeded preference was gone.
        body: JSON.stringify({ shopperId: shopper.id }),
      });
      if (!res.ok) {
        window.alert(`Reset failed (HTTP ${res.status}). See the server logs.`);
        return;
      }
      // The cart and orders live in localStorage, not on the server, so the
      // CLIENT owns clearing them. Every shopper's keys, not just the current
      // one — a reset that leaves the other persona's basket behind is a reset
      // that lies.
      // Through the store's own key helpers, not hand-written template strings:
      // two sources of truth for the key format is how a reset quietly stops
      // clearing anything after someone renames a key.
      for (const s of shoppers) {
        window.localStorage.removeItem(cartStorageKey(s.id));
        window.localStorage.removeItem(ordersStorageKey(s.id));
      }
      // A FULL DOCUMENT LOAD, not `router.push`. The keys above were removed
      // behind the store's back and the store deliberately registers no
      // `storage` listener, so nothing invalidates its cached snapshot — only a
      // fresh load re-reads storage. A client-side navigation would leave the
      // cart visibly full immediately after a "successful" reset. It also gives
      // the clean starting URL the demo should always open on, which is `/`
      // itself on a locked single-tenant deploy.
      window.location.assign(skinHref());
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    // h-full + overflow-hidden (never h-screen/min-h-screen): this chrome must be
    // exactly as tall as the shell's app CARD, which the frame has already inset
    // by its own padding — a viewport-height root overflows the card by exactly
    // that much. It must also stay BOUNDED: if the container can grow past the
    // card the whole document scrolls, taking the pinned nav with it, and
    // <main>'s own overflow-y-auto goes inert because its parent is unbounded.
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-7 flex items-center gap-2.5 px-2 text-brand">
          <Logo className="h-7 w-7" />
          <span className="bookstore-display text-base font-bold tracking-tight text-ink">
            {skin.identity.brand}
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {skin.nav.map((route) => {
            const href = skinHref(route.segment);
            // Compare SEGMENTS, not whole pathnames: under a lock the href is
            // prefix-free while the matched route is not, so `pathname === href`
            // is not reliably true for the active entry. A book detail page is
            // still "the shelf" as far as the nav is concerned.
            const active =
              route.segment === ""
                ? restHead === "" ||
                  restHead === "browse" ||
                  restHead === "book"
                : restHead === route.segment;
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
                {route.segment === "cart" ? (
                  <span className="relative">
                    <ShoppingBag className="h-4 w-4" />
                    {/* The add-to-cart affordance: a pinging dot the moment the
                        agent adds something, visible from anywhere in the app. */}
                    {data.lastAddedId ? (
                      <span
                        aria-hidden="true"
                        className="absolute -right-1 -top-1 h-2 w-2 animate-ping rounded-full bg-brand"
                      />
                    ) : null}
                  </span>
                ) : null}
                {route.label}
                {route.segment === "cart" && itemCount > 0 ? (
                  <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-foreground">
                    {itemCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          {/* Meta-utility strip — skin-authored chrome, pinned to the bottom; the
              shell provides no Reset and no Help for free. Deliberately NO
              ThemeToggle: this skin ships no dark palette (theme.css sets no
              --nw-dark-capable and has no `.dark` block), so the control would
              toggle nothing. */}
          <TooltipProvider delayDuration={200}>
            <div className="flex items-center gap-1 border-t border-hairline px-1 pt-3">
              {resetEnabled ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void handleReset()}
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
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ask the assistant for help"
                    onClick={() =>
                      void askCopilot(
                        "What can you help me with in this store? Give me a short list.",
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Ask the assistant for help</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          {/* The shopper switcher. This is the memory beat's control: the SAME
              pill as Maya and as Guest produces two different answers, because
              Intelligence scopes durable memory per end user. */}
          <div className="rounded-md border border-hairline bg-surface-muted p-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Shopping as
            </div>
            <select
              aria-label="Current shopper"
              className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink"
              value={shopper.id}
              onChange={(e) => setShopperId(e.target.value)}
            >
              {shoppers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="mt-1.5 text-[11px] text-ink-muted">
              {shopper.id === "maya"
                ? "Has shopped here before"
                : "First visit — nothing remembered"}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-5 py-6">{children}</main>
    </div>
  );
}
