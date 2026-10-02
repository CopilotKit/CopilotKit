"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CreditCard, ShieldAlert } from "lucide-react";
import { useCardSummaries } from "../data/recon-client";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { formatDate, useLedger } from "../data/client";
import {
  CATEGORY_COLORS,
  compactMoney,
  holdTrend,
  nextPaymentRun,
  spendByCategory,
  weeklySpend,
} from "../data/derive";
import {
  Avatar,
  BarList,
  Chip,
  Columns,
  Id,
  Money,
  Stat,
  StatStrip,
  StatusPill,
  rowLink,
  td,
  th,
} from "../components/ui";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The work queue first (Ramp's lesson), the analytics second. */
export function OverviewPage() {
  const { data } = useLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const awaiting = data.reports.filter((r) => r.status === "submitted");
  const held = awaiting.filter((r) => r.holds.some((h) => h.status === "open"));
  const ready = data.reports.filter((r) => r.status === "approved");
  const paid = data.reports.filter((r) => r.status === "reimbursed");
  const week = weeklySpend(data);
  const hold = holdTrend(data);
  const run = nextPaymentRun(data.today);
  const queue = [
    ...held,
    ...awaiting
      .filter((r) => !held.includes(r))
      .sort((a, b) => b.total - a.total),
  ].slice(0, 7);

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">
          {greeting()}, {data.currentUser.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {awaiting.length} reports wait on you
          {held.length ? `, ${held.length} on policy hold` : ""}. Next ACH run{" "}
          {formatDate(run)}.
        </p>
      </div>

      <CloseCard href={skinHref("reconciliation")} />

      <StatStrip>
        <Stat
          label="Awaiting approval"
          value={<Money value={awaiting.reduce((a, r) => a + r.total, 0)} />}
          hint={`${awaiting.length} reports`}
        />
        <Stat
          label="On policy hold"
          value={held.length}
          tone={held.length ? "red" : undefined}
          hint={<Money value={held.reduce((a, r) => a + r.total, 0)} />}
        />
        <Stat
          label="Ready to reimburse"
          value={<Money value={ready.reduce((a, r) => a + r.total, 0)} />}
          hint={`${ready.length} approved`}
        />
        <Stat
          label="Reimbursed this quarter"
          value={<Money value={paid.reduce((a, r) => a + r.total, 0)} />}
          hint={`${paid.length} reports`}
        />
      </StatStrip>

      <div className="mb-8 grid gap-6 @[700px]:grid-cols-[1.25fr_1fr_0.8fr]">
        <section className="rounded-[10px] border border-hairline p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold">Submitted spend</h2>
            <span className="shrink-0 text-[11.5px] text-[hsl(var(--ll-faint))]">
              by week
            </span>
          </div>
          <Columns
            values={week.values}
            labels={week.labels}
            format={compactMoney}
            height={96}
          />
        </section>
        <section className="rounded-[10px] border border-hairline p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold">Spend by category</h2>
            <span className="shrink-0 text-[11.5px] text-[hsl(var(--ll-faint))]">
              this quarter
            </span>
          </div>
          <BarList
            rows={spendByCategory(data)
              .slice(0, 5)
              .map((r, i) => ({ ...r, color: CATEGORY_COLORS[i] }))}
            format={compactMoney}
          />
        </section>
        <section className="rounded-[10px] border border-hairline p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold">Policy holds raised</h2>
            <span className="shrink-0 text-[11.5px] text-[hsl(var(--ll-faint))]">
              by week
            </span>
          </div>
          <Columns
            values={hold.values}
            labels={hold.labels}
            format={(n) => String(n)}
            tone="red"
            height={96}
          />
        </section>
      </div>

      <div className="grid gap-8">
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Needs your attention</h2>
            <Link
              href={skinHref("approvals")}
              data-action="View approvals queue"
              className="flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
            >
              Approvals queue <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-hairline">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Report</th>
                  <th className={th}>Employee</th>
                  <th className={th}>Status</th>
                  <th className={cn(th, "text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((r) => {
                  const hold = r.holds.find((h) => h.status === "open");
                  return (
                    <tr
                      key={r.id}
                      data-action="Open report"
                      onClick={() => router.push(skinHref(`reports/${r.id}`))}
                      className={rowLink}
                    >
                      <td className={td}>
                        <Link
                          href={skinHref(`reports/${r.id}`)}
                          data-action="Open report"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium hover:text-brand"
                        >
                          {r.title}
                        </Link>
                        <div>
                          <Id className="text-[11.5px]">{r.id}</Id>{" "}
                          <span className="shrink-0 text-[11.5px] text-[hsl(var(--ll-faint))]">
                            {r.category}
                          </span>
                        </div>
                      </td>
                      <td className={td}>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <Avatar name={r.employeeName} size="sm" />{" "}
                          {r.employeeName}
                        </span>
                      </td>
                      <td className={td}>
                        {hold ? (
                          <Chip tone="red">
                            <ShieldAlert className="h-3 w-3" /> Hold {hold.code}
                          </Chip>
                        ) : (
                          <StatusPill status={r.status} />
                        )}
                      </td>
                      <td className={cn(td, "text-right font-medium")}>
                        <Money value={r.total} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-8 text-[13px] font-semibold">
            Recent activity
          </h2>
          <ul className="divide-y divide-hairline border-y border-hairline">
            {data.activity.slice(0, 8).map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[64px_1fr_auto] items-baseline gap-3 py-2.5 text-[13px]"
              >
                <span className="text-[12px] text-[hsl(var(--ll-faint))]">
                  {formatDate(a.at.slice(0, 10))}
                </span>
                <span className="truncate">
                  <span className="font-medium">{a.actor}</span>{" "}
                  <span className="text-ink-muted">{a.text}</span>
                </span>
                <Id className="text-[11.5px]">{a.reportId}</Id>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** The month-end close, first on the page: how many card charges still need a receipt. */
function CloseCard({ href }: { href: string }) {
  const cards = useCardSummaries();
  if (!cards)
    return <div className="mb-6 h-[76px] rounded-[10px] bg-surface-muted" />;
  const open = cards.filter((c) => !c.closed && c.unmatched > 0);
  const total = open.reduce((n, c) => n + c.unmatched, 0);
  const first = open[0];
  if (!first)
    return (
      <div className="mb-6 flex items-center gap-3 rounded-[10px] border border-positive/25 bg-positive-soft px-4 py-3 text-[13px]">
        <CreditCard className="h-4 w-4 text-positive" />
        <span className="font-semibold">Month-end close</span>
        <span className="text-ink-muted">
          Every card is closed for {cards[0]?.periodLabel}.
        </span>
      </div>
    );
  return (
    <Link
      href={`${href}?card=${first.id}`}
      data-action="Open month-end close"
      data-testid="overview-close-card"
      className="group mb-6 flex items-center gap-4 rounded-[10px] border border-hairline bg-surface px-4 py-3.5 transition-[border-color,box-shadow] hover:border-brand/40 hover:shadow-[0_2px_10px_-4px_hsl(225_40%_30%/0.18)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-brand-soft text-brand">
        <CreditCard className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold">Month-end close</span>
          <span className="ll-num rounded-full bg-[hsl(var(--ll-amber)/0.16)] px-2 py-0.5 text-[11.5px] font-medium text-[hsl(32_80%_30%)]">
            {total} unmatched
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-ink-muted">
          {first.periodLabel} card charges waiting for receipts:{" "}
          {open
            .map((c) => `${c.holder} •• ${c.last4} (${c.unmatched})`)
            .join(", ")}
        </div>
      </div>
      <span className="flex items-center gap-1 text-[13px] font-medium text-brand">
        Reconcile{" "}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
