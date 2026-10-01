"use client";
import "./theme.css";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ListRestart, RotateCcw, Search } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { cn } from "@/lib/utils";
import { useLedger } from "./data/client";
import { useLedgerlineReset } from "./components/reset-panel";
import { CommandPalette } from "./components/command-palette";
import { useInspectorClearOfChat } from "./components/inspector-placement";
import { Avatar } from "./components/ui";
import { usePublishedSkills } from "./learned-skills";
import { ledgerlineIdentity } from "./identity";

const ROUTE_NAME: Map<string, string> = new Map([
  ["", "overview"],
  ["reports", "expense reports"],
  ["approvals", "approvals queue"],
  ["reimbursements", "reimbursements"],
  ["cost-centers", "cost centers"],
  ["people", "people"],
  ["policies", "policies"],
]);

const CRUMB: Map<string, string> = new Map([
  ["", "Overview"],
  ["reports", "Expense reports"],
  ["approvals", "Approvals"],
  ["reimbursements", "Reimbursements"],
  ["cost-centers", "Cost centers"],
  ["people", "People"],
  ["policies", "Policies"],
]);

/**
 * The app frame: a slim left nav, a 52px header (breadcrumb, ⌘K search, the
 * user) and the page. The chat docks on the RIGHT of this frame by the skin's
 * `layoutDefaults`.
 */
export function LedgerlineLayout({ children }: { children: ReactNode }) {
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const segments = useSkinSegments(skin.id);
  const head = segments[0] ?? "";
  const resetEnabled = usePresenterReset();
  const reset = useLedgerlineReset(() => window.location.assign(skinHref()));
  const { data } = useLedger();
  const published = usePublishedSkills();
  const Logo = ledgerlineIdentity.logo;
  const [palette, setPalette] = useState(false);
  useInspectorClearOfChat();

  // The agent knows WHICH page is open, not what is drawn on it: the policy
  // text and the cost-center budget types are deliberately not in its context.
  useAgentContext({
    description: "The Ledgerline page the user is currently on.",
    value:
      segments.length > 1
        ? `${ROUTE_NAME.get(head) ?? head} (${segments[1]})`
        : (ROUTE_NAME.get(head) ?? head),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const awaiting = data.reports.filter((r) => r.status === "submitted").length;
  const crumbs: { label: string; href?: string }[] = [
    {
      label: CRUMB.get(head) ?? head,
      href: segments.length > 1 ? skinHref(head) : undefined,
    },
  ];
  if (segments[1]) crumbs.push({ label: segments[1] });

  return (
    <div
      className="flex h-full overflow-hidden bg-canvas text-ink"
      data-ledgerline-app=""
    >
      <aside
        data-ledgerline-nav
        className="hidden h-full w-[200px] shrink-0 flex-col border-r border-hairline bg-surface-muted md:flex"
      >
        <div className="flex h-[52px] items-center gap-2 px-4">
          <Logo className="h-5 w-5" />
          <span className="text-[15px] font-semibold tracking-[-0.015em]">
            Ledgerline
          </span>
        </div>
        <div className="px-2 pb-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-ink text-[9px] font-bold text-white">
              HL
            </span>
            <span className="truncate text-[12.5px] font-medium">
              {data.company}
            </span>
          </div>
        </div>
        <nav className="flex flex-col gap-px px-2">
          {skin.nav.map((route) => {
            const active = head === route.segment;
            const Icon = route.icon;
            return (
              <Link
                key={route.segment || "index"}
                href={skinHref(route.segment)}
                data-action={`Nav: ${route.label}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                  active
                    ? "bg-brand-soft font-medium text-brand-indigo"
                    : "text-ink-muted hover:bg-[hsl(225_10%_93%)] hover:text-ink",
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 h-5 w-[2px] rounded-full bg-brand"
                  />
                ) : null}
                {Icon ? (
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      active ? "text-brand" : "text-[hsl(var(--ll-faint))]",
                    )}
                  />
                ) : null}
                <span className="flex-1">{route.label}</span>
                {route.segment === "approvals" && awaiting > 0 ? (
                  <span className="ll-num text-[11.5px] font-medium text-ink-muted">
                    {awaiting}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-1 border-t border-hairline px-2 py-2">
          <div className="flex items-center gap-1 px-1">
            {resetEnabled ? (
              <>
                <button
                  type="button"
                  data-no-record=""
                  onClick={() => void reset.start()}
                  aria-label="Reset demo state"
                  title="Reset demo state"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--ll-faint))] hover:bg-[hsl(225_10%_93%)] hover:text-ink"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  data-no-record=""
                  onClick={async () => {
                    await fetch("/api/ledgerline/v1/dev/reset", {
                      method: "POST",
                    });
                    window.location.assign(skinHref());
                  }}
                  aria-label="Restore the expense reports, keep what was learned"
                  title="Restore the expense reports only. Trajectories, insights and published skills are kept, so the same request can be retried."
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--ll-faint))] hover:bg-[hsl(225_10%_93%)] hover:text-ink"
                >
                  <ListRestart className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
            <span
              title="Learned skills the assistant can load, published from Automatic Learning"
              className={cn(
                "ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium",
                published && published.length
                  ? "bg-brand-soft text-brand-indigo"
                  : "text-[hsl(var(--ll-faint))]",
              )}
            >
              Skills: {published === null ? "..." : `${published.length} live`}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-hairline bg-canvas px-6">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-[13px]"
          >
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 ? (
                  <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--ll-faint))]" />
                ) : null}
                {c.href ? (
                  <Link
                    href={c.href}
                    data-action={`Breadcrumb: ${c.label}`}
                    className="truncate text-ink-muted hover:text-ink"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "truncate",
                      i === crumbs.length - 1
                        ? "font-medium text-ink"
                        : "text-ink-muted",
                      i > 0 && "ll-mono",
                    )}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
          <button
            type="button"
            data-action="Open search"
            onClick={() => setPalette(true)}
            className="ml-auto flex h-8 w-[280px] items-center gap-2 rounded-md border border-hairline bg-surface-muted px-2.5 text-[13px] text-[hsl(var(--ll-faint))] transition-colors hover:border-[hsl(225_10%_82%)]"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-hairline bg-surface px-1 text-[10.5px] text-ink-muted">
              ⌘K
            </kbd>
          </button>
          <div className="flex items-center gap-2">
            <Avatar name={data.currentUser.name} />
            <div className="hidden leading-tight xl:block">
              <div className="text-[12.5px] font-medium">
                {data.currentUser.name}
              </div>
              <div className="text-[11px] text-[hsl(var(--ll-faint))]">
                {data.currentUser.title}
              </div>
            </div>
          </div>
        </header>
        <main className="@container min-w-0 flex-1 overflow-y-auto px-8 py-7">
          {children}
        </main>
      </div>
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        data={data}
        href={skinHref}
      />
      {reset.panel}
    </div>
  );
}
