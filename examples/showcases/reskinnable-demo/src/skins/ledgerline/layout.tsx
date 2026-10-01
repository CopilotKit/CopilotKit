"use client";
import "./theme.css";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronsUpDown, ListRestart, RotateCcw } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { cn } from "@/lib/utils";
import { useLedger } from "./data/client";
import { useLedgerlineReset } from "./components/reset-panel";
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

  // The agent knows WHICH page is open, not what is drawn on it: the Policy
  // panel's text is deliberately not part of the agent's context.
  useAgentContext({
    description: "The Ledgerline page the user is currently on.",
    value:
      segments.length > 1
        ? `${ROUTE_NAME.get(head) ?? head} (${segments[1]})`
        : (ROUTE_NAME.get(head) ?? head),
  });

  const awaiting = data.reports.filter((r) => r.status === "submitted").length;

  return (
    <div
      className="flex h-full overflow-hidden bg-canvas text-ink"
      data-ledgerline-app=""
    >
      <aside className="hidden h-full w-[228px] shrink-0 flex-col border-r border-hairline bg-surface px-3 py-4 md:flex">
        <div className="mb-4 flex items-center gap-2 px-2">
          <Logo className="h-6 w-6" />
          <span className="text-[1.08rem] font-semibold tracking-[-0.02em]">
            Ledgerline
          </span>
        </div>

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[0.68rem] font-bold text-surface">
            HL
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.78rem] font-semibold">
              {data.company}
            </div>
            <div className="text-[0.66rem] text-ink-muted">
              Finance workspace
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-ink-muted" />
        </div>

        <nav className="flex flex-col gap-0.5">
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
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.84rem] font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                <span className="flex-1">{route.label}</span>
                {route.segment === "approvals" && awaiting > 0 ? (
                  <span className="rounded-full bg-brand px-1.5 py-0.5 text-[0.62rem] font-bold tabular-nums text-brand-foreground">
                    {awaiting}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2.5">
          <div className="flex items-center gap-1 border-t border-hairline px-1 pt-2.5">
            {resetEnabled ? (
              <button
                type="button"
                data-no-record=""
                onClick={() => void reset.start()}
                aria-label="Reset demo state"
                title="Reset demo state"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : null}
            {resetEnabled ? (
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
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <ListRestart className="h-4 w-4" />
              </button>
            ) : null}
            <span
              title="Learned skills the assistant can load, published from Automatic Learning"
              className={cn(
                "rounded-md px-2 py-1 text-[0.7rem] font-medium",
                published && published.length > 0
                  ? "bg-brand-soft text-brand"
                  : "text-ink-muted",
              )}
            >
              Skills: {published === null ? "..." : `${published.length} live`}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[0.66rem] font-bold text-brand-foreground">
              MC
            </span>
            <div className="min-w-0">
              <div className="truncate text-[0.76rem] font-semibold">
                {data.currentUser.name}
              </div>
              <div className="truncate text-[0.66rem] text-ink-muted">
                {data.currentUser.title}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
        {children}
      </main>
      {reset.panel}
    </div>
  );
}
