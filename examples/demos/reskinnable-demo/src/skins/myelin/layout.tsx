"use client";
import "./theme.css"; // side-effect import registers the .theme-myelin block

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HelpCircle, Palette, RotateCcw } from "lucide-react";
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
import { useMyelinLedger } from "./data/ledger-context";
import { useAskCopilot } from "./components/use-ask-copilot";
import { Avatar } from "./components/primitives";

const SIDEBAR_WIDTH_PX = 232;

const ROUTE_READABLE_NAME: Record<string, string> = {
  "": "Journeys (builder)",
  journey: "Journeys (builder)",
  groups: "Groups",
  learners: "Learners",
  audit: "Audit log",
};

const TENANT_KEY = "myelin-tenant";
type Tenant = "myelin" | "harvest";

/**
 * Customer branding, live. Flips `<html data-tenant>`, which `theme.css` keys a
 * second palette off. Every component in this skin — including every card the
 * agent renders into the chat — is written against the shared tokens, so this
 * one attribute rebrands the whole experience at once. That is the answer to
 * "we support customer branding" shown rather than claimed.
 */
function useTenant(): [Tenant, (t: Tenant) => void] {
  const [tenant, setTenant] = useState<Tenant>("myelin");
  useEffect(() => {
    let stored: Tenant = "myelin";
    try {
      stored =
        window.localStorage.getItem(TENANT_KEY) === "harvest"
          ? "harvest"
          : "myelin";
    } catch {
      // storage blocked — default brand
    }
    queueMicrotask(() => setTenant(stored));
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (tenant === "harvest") root.dataset.tenant = "harvest";
    else delete root.dataset.tenant;
    try {
      window.localStorage.setItem(TENANT_KEY, tenant);
    } catch {
      // ignore
    }
    return () => {
      delete root.dataset.tenant;
    };
  }, [tenant]);
  return [tenant, setTenant];
}

/** Harvest Lane's mark: a wheat sheaf, drawn in currentColor. */
function HarvestMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21V8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M12 9c-2.6 0-4-1.8-4-4.5 2.6 0 4 1.8 4 4.5Zm0 0c2.6 0 4-1.8 4-4.5-2.6 0-4 1.8-4 4.5Z"
        fill="currentColor"
      />
      <path
        d="M12 14c-2.6 0-4-1.8-4-4.5 2.6 0 4 1.8 4 4.5Zm0 0c2.6 0 4-1.8 4-4.5-2.6 0-4 1.8-4 4.5Z"
        fill="currentColor"
        opacity=".7"
      />
    </svg>
  );
}

export function MyelinLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const restHead = useSkinSegments(skin.id)[0] ?? "";
  const resetEnabled = usePresenterReset();
  const askCopilot = useAskCopilot();
  const { data, admin, setAdminId } = useMyelinLedger();
  const { clear } = useCanvas();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tenant, setTenant] = useTenant();
  const Logo = skin.identity.logo;

  useAgentContext({
    description:
      "The page the admin is currently looking at in the Myelin admin console.",
    value: ROUTE_READABLE_NAME[restHead] ?? restHead,
  });

  useAgentContext({
    description:
      "The signed-in Myelin admin (a Harvest Lane Grocers L&D admin).",
    value: JSON.stringify({
      id: admin.id,
      name: admin.name,
      title: admin.title,
    }),
  });

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  const online = data.presence
    .filter((p) => p.adminId !== admin.id)
    .map((p) => data.admins.find((a) => a.id === p.adminId))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  const handleReset = async () => {
    if (
      !window.confirm(
        "Reset the demo? This restores the seeded Harvest Lane scenario.",
      )
    )
      return;
    try {
      const res = await fetch("/api/myelin/v1/dev/reset", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        memoryError?: string;
        error?: string;
        message?: string;
      };
      if (body.error && !res.ok && res.status === 403) {
        window.alert(`The demo was NOT reset: ${body.message ?? "refused"}`);
        return;
      }
      if (body.memoryError)
        window.alert(`Data reset. Memory was not: ${body.memoryError}`);
    } catch (err) {
      window.alert(`Reset could not be confirmed: ${String(err)}. Reloading.`);
    }
    window.location.assign(skinHref());
  };

  const nav = skin.nav;

  return (
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <aside
        className="hidden h-full shrink-0 flex-col border-r border-hairline bg-surface px-3 py-5 md:flex"
        style={{ width: SIDEBAR_WIDTH_PX }}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          {tenant === "harvest" ? (
            <HarvestMark className="h-7 w-7 text-brand" />
          ) : (
            <Logo className="h-7 w-7 text-brand" />
          )}
          <div className="min-w-0">
            <div className="truncate text-base font-semibold tracking-tight text-ink">
              {tenant === "harvest" ? "Harvest Lane" : skin.identity.brand}
            </div>
            <div className="truncate text-[0.68rem] text-ink-muted">
              {tenant === "harvest"
                ? "Learning · powered by Myelin"
                : "Admin · Harvest Lane Grocers"}
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {nav.map((route) => {
            const href = skinHref(route.segment);
            const active =
              restHead === route.segment ||
              (route.segment === "" && restHead === "journey");
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

        <div className="mt-6 px-2">
          <div className="text-[0.66rem] font-semibold uppercase tracking-wide text-ink-muted">
            Online now
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {[admin, ...online].map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 text-[0.74rem] text-ink"
              >
                <span className="relative">
                  <Avatar admin={a} size="sm" />
                  <span className="my-presence-dot absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface bg-positive" />
                </span>
                <span className="truncate">
                  {a.name}
                  {a.id === admin.id ? (
                    <span className="text-ink-muted"> (you)</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto">
          {/* No GovernancePopover (the tenant / memory-posture control) here, on
              purpose: this skin's story is journey governance, and a second
              "governance" control about memory isolation muddies it. Memory
              runs on the default posture (isolated: user read-write). */}
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
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Switch tenant branding"
                    onClick={() =>
                      setTenant(tenant === "harvest" ? "myelin" : "harvest")
                    }
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-brand-soft hover:text-brand",
                      tenant === "harvest" ? "text-brand" : "text-ink-muted",
                    )}
                  >
                    <Palette className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {tenant === "harvest"
                    ? "Back to Myelin branding"
                    : "Apply Harvest Lane branding"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ask Myelin for help"
                    onClick={() =>
                      void askCopilot(
                        "What can you help me with in Myelin? Give me a short list.",
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ask Myelin for help</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-hairline bg-surface-muted px-2 py-2">
            <Avatar admin={admin} size="sm" />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Signed in as</span>
              <select
                value={admin.id}
                onChange={(event) => setAdminId(event.target.value)}
                className="w-full cursor-pointer truncate bg-transparent text-[0.75rem] font-medium text-ink outline-none"
              >
                {data.admins.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <span className="block truncate text-[0.65rem] text-ink-muted">
                {admin.title}
              </span>
            </label>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
    </div>
  );
}
