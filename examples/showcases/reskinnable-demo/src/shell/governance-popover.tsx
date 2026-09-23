"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEFAULT_POSTURE_ID,
  DEMO_TENANTS,
  MEMORY_GRANT_COOKIE,
  MEMORY_POSTURES,
  TENANT_COOKIE,
  isDemoTenant,
  postureById,
  tenantById,
} from "@/shell/governance";
import { cn } from "@/lib/utils";

/**
 * Who is using the app, and how much memory they are allowed — the two SHELL
 * controls that decide which Intelligence memory bucket every request touches.
 *
 * ── SHELL COMPONENT, SKIN PLACEMENT ─────────────────────────────────────────
 * The logic is shell-owned because every skin resolves memory through the same
 * two runtime callbacks — there is nothing domain-specific about an organization
 * or a memory policy. But it RENDERS inside each skin's own chrome, beside that
 * skin's user switcher, because that is where someone using the product looks
 * for "who am I signed in as". Putting it up in the assistant column separates
 * it from the identity control it belongs next to, and reads as demo plumbing
 * rather than as part of the app.
 *
 * So: a skin imports this and drops it next to its own switcher — the same shape
 * as `usePresenterReset` and the teach-mode `RecordingProvider`, both of which
 * skins already import from the shell.
 *
 * The two switchers compose rather than compete. The skin names the PERSON, this
 * names the CUSTOMER, and the resolved memory bucket is `<tenant>:<persona>` —
 * so the same persona id under two organizations is two different sets of
 * memories, which is the whole property being demonstrated.
 *
 * ── WHY SWITCHING RELOADS ───────────────────────────────────────────────────
 * The scope is resolved SERVER-side, per request, from the cookie. Everything
 * already fetched under the old identity — the thread rail, any memory list, the
 * open conversation — belongs to the previous organization, and leaving it on
 * screen under a new organization's name is the single most confusing thing this
 * control could do in front of a room. A reload is also honest about what
 * switching customer means: a different person, a fresh session.
 */

/** Read one cookie in the browser. Returns undefined for absent-or-empty. */
function readBrowserCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return value === "" ? undefined : value;
  }
  return undefined;
}

/**
 * `document.cookie` is an external system, so it is read through
 * `useSyncExternalStore` rather than `useState` — the same reasoning as
 * `layout-preferences.tsx`. Nothing mutates these cookies except this component,
 * and every mutation is followed by a reload, so the store never needs to
 * notify: `subscribe` returns a no-op unsubscribe and the snapshot is read fresh
 * on each render pass React asks for.
 *
 * `getServerSnapshot` returns the defaults, which is also what the server
 * resolves when the cookie is absent — so the un-switched first paint agrees
 * with the markup React produced on the server.
 */
const NEVER_CHANGES = () => () => {};

function useCookie(name: string, fallback: string): string {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => readBrowserCookie(name) ?? fallback,
    () => fallback,
  );
}

function OptionRow({
  selected,
  title,
  blurb,
  onSelect,
}: {
  selected: boolean;
  title: string;
  blurb: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        selected
          ? "border-brand bg-brand-soft"
          : "border-transparent hover:bg-surface-muted",
      )}
    >
      <span
        className={cn(
          "text-sm font-medium",
          selected ? "text-brand" : "text-ink",
        )}
      >
        {title}
      </span>
      <span className="text-[11px] leading-snug text-ink-muted">{blurb}</span>
    </button>
  );
}

/**
 * `variant` exists because the skins do not share a chrome shape. Most put their
 * user switcher in a wide header row, where the customer's name and the current
 * policy should both be readable at rest. Banking's is a ~56px icon rail, where
 * any label overflows the rail and spills across the page — so that one gets the
 * glyph alone, with the same text moved onto `title`.
 *
 * A prop rather than a container query: the rail's width is a fixed decision the
 * skin already made, so asking the skin is both simpler and honest about who
 * knows the answer.
 */
/**
 * Forget what the demo has taught the agent, in BOTH organizations, so the next
 * run-through starts from "Remembering this for next time" rather than from a
 * preference last week's rehearsal left behind.
 *
 * Deliberately NOT a confirmation dialog: a presenter clicks this between takes,
 * and a modal in front of a room costs more than the mistake it prevents. It
 * forgets only user-scoped memories the switcher itself created, so the worst
 * case is re-teaching one sentence.
 */
function ForgetButton() {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">(
    "idle",
  );

  const forget = useCallback(async () => {
    setState("working");
    try {
      const agentId = window.location.pathname.split("/").filter(Boolean)[0];
      const res = await fetch("/api/governance/forget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      setState(res.ok ? "done" : "failed");
    } catch {
      setState("failed");
    }
  }, []);

  const label = {
    idle: "Forget what it has learned",
    working: "Forgetting…",
    done: "Forgotten — reload to start clean",
    failed: "Could not forget — see the server log",
  }[state];

  return (
    <button
      type="button"
      onClick={() => void forget()}
      disabled={state === "working"}
      className={cn(
        "mt-1 flex items-center justify-center gap-1.5 rounded-md border border-hairline px-2 py-1.5",
        "text-[11px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        state === "failed"
          ? "border-negative/40 text-negative"
          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
        state === "working" && "opacity-60",
      )}
    >
      <RotateCcw className="h-3 w-3 flex-none" />
      {label}
    </button>
  );
}

export function GovernancePopover({
  variant = "full",
}: {
  variant?: "full" | "icon";
}) {
  const tenantId = useCookie(TENANT_COOKIE, DEMO_TENANTS[0].id);
  const postureId = useCookie(MEMORY_GRANT_COOKIE, DEFAULT_POSTURE_ID);

  const tenant = tenantById(isDemoTenant(tenantId) ? tenantId : undefined);
  const posture = postureById(postureId);

  // Session cookies (no max-age): a booth laptop closed and reopened comes back
  // to the safe default rather than to whatever the last demo left switched on.
  const commit = useCallback((name: string, value: string) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
    window.location.reload();
  }, []);

  return (
    <Popover>
      <PopoverTrigger
        // h-10 is the height every skin's own Select trigger uses, so the two sit
        // on one baseline wherever they appear side by side.
        className={cn(
          "flex h-10 items-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          variant === "icon"
            ? "w-10 flex-none justify-center text-ink-muted hover:bg-surface-muted hover:text-ink"
            : "max-w-[200px] gap-2 border border-hairline px-2.5 text-left hover:bg-surface-muted",
        )}
        aria-label="Organization and memory policy"
        title={`${tenant?.name ?? "No organization"} — memory: ${posture.name}`}
      >
        <ShieldCheck className="h-4 w-4 flex-none text-ink-muted" />
        {variant === "full" ? (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium text-ink">
              {tenant?.name ?? "No organization"}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              Memory: {posture.name}
            </span>
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-1">
            <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Organization
            </h3>
            {DEMO_TENANTS.map((option) => (
              <OptionRow
                key={option.id}
                selected={option.id === tenant?.id}
                title={option.name}
                blurb={option.blurb}
                onSelect={() => commit(TENANT_COOKIE, option.id)}
              />
            ))}
          </section>

          <section className="flex flex-col gap-1 border-t border-hairline pt-3">
            <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Memory policy
            </h3>
            {MEMORY_POSTURES.map((option) => (
              <OptionRow
                key={option.id}
                selected={option.id === posture.id}
                title={option.name}
                blurb={option.blurb}
                onSelect={() => commit(MEMORY_GRANT_COOKIE, option.id)}
              />
            ))}
          </section>

          {/*
            The grant exactly as the server will resolve it for the next request.
            This is the point of the whole panel: the control is not a metaphor
            for the policy, it is the policy's input, and the row below is what
            travels to Intelligence before the agent is handed a memory tool.
          */}
          <footer className="flex flex-col gap-1 border-t border-hairline pt-3">
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Grant sent with every request
            </span>
            <code className="rounded bg-surface-muted px-2 py-1.5 font-mono text-[11px] text-ink">
              user: {posture.grant.user} · project: {posture.grant.project}
            </code>
            <span className="px-1 text-[10px] leading-snug text-ink-muted">
              Switching either setting reloads the app and starts a fresh
              conversation.
            </span>
            <ForgetButton />
          </footer>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default GovernancePopover;
