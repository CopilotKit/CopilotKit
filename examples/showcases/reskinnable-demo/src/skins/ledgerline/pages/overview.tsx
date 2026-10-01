"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  MessageSquare,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { formatDate, formatMoney, useLedger } from "../data/client";
import {
  compactMoney,
  nextPaymentRun,
  spendByCategory,
  weeklySpend,
} from "../data/derive";
import type { Activity } from "../data/types";
import {
  Avatar,
  Badge,
  BarList,
  Card,
  CardHeader,
  Columns,
  Stat,
  StatusPill,
} from "../components/ui";

const ACTIVITY_ICON: Record<Activity["kind"], typeof Clock> = {
  submitted: Clock,
  approved: CheckCircle2,
  reimbursed: Wallet,
  allocated: ArrowRight,
  note: MessageSquare,
  hold: ShieldAlert,
  rejected: ShieldAlert,
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function OverviewPage() {
  const { data } = useLedger();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const awaiting = data.reports.filter((r) => r.status === "submitted");
  const held = awaiting.filter((r) => r.holds.some((h) => h.status === "open"));
  const ready = data.reports.filter((r) => r.status === "approved");
  const week = weeklySpend(data);
  const run = nextPaymentRun(data.today);
  const attention = [
    ...held,
    ...awaiting
      .filter((r) => !held.includes(r))
      .sort((a, b) => b.total - a.total),
  ].slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {data.company}
        </div>
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em]">
          {greeting()}, {data.currentUser.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-ink-muted">
          {awaiting.length} reports are waiting for your approval. The next
          payment run is {formatDate(run)}.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Awaiting approval"
          value={formatMoney(awaiting.reduce((a, r) => a + r.total, 0))}
          tone="brand"
        />
        <Stat label="Reports waiting" value={awaiting.length} />
        <Stat label="On policy hold" value={held.length} tone="warn" />
        <Stat
          label="Ready to reimburse"
          value={formatMoney(ready.reduce((a, r) => a + r.total, 0))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Needs your attention"
            action={
              <Link
                href={skinHref("approvals")}
                data-action="View approvals queue"
                className="text-[0.76rem] font-medium text-brand hover:underline"
              >
                Approvals queue
              </Link>
            }
          />
          <ul>
            {attention.map((r) => {
              const hold = r.holds.find((h) => h.status === "open");
              return (
                <li
                  key={r.id}
                  className="border-b border-hairline last:border-0"
                >
                  <Link
                    href={skinHref(`reports/${r.id}`)}
                    data-action="Open report"
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-muted"
                  >
                    <Avatar name={r.employeeName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[0.84rem] font-medium">
                        {r.title}
                      </div>
                      <div className="text-[0.72rem] text-ink-muted">
                        {r.employeeName} · {r.category} ·{" "}
                        <span className="font-mono">{r.id}</span>
                      </div>
                    </div>
                    {hold ? (
                      <Badge tone="negative">
                        <ShieldAlert className="h-3 w-3" /> Hold {hold.code}
                      </Badge>
                    ) : (
                      <StatusPill status={r.status} />
                    )}
                    <span className="w-24 text-right text-[0.84rem] font-semibold tabular-nums">
                      {formatMoney(r.total)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Submitted spend, by week" />
          <div className="px-4 py-4">
            <Columns
              values={week.values}
              labels={week.labels}
              format={compactMoney}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Spend by category"
            action={
              <span className="text-[0.7rem] text-ink-muted">This quarter</span>
            }
          />
          <div className="px-4 py-4">
            <BarList
              rows={spendByCategory(data).slice(0, 6)}
              format={formatMoney}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          <ul className="max-h-[22rem] overflow-y-auto">
            {data.activity.slice(0, 12).map((a) => {
              const Icon = ACTIVITY_ICON[a.kind];
              return (
                <li
                  key={a.id}
                  className="flex items-start gap-2.5 border-b border-hairline px-4 py-2 text-[0.78rem] last:border-0"
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  <div className="min-w-0">
                    <span className="font-medium">{a.actor}</span>{" "}
                    <span className="text-ink-muted">{a.text}</span>
                    <div className="text-[0.66rem] text-ink-muted">
                      {formatDate(a.at.slice(0, 10))} ·{" "}
                      <span className="font-mono">{a.reportId}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
