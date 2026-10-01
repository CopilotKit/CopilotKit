"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { formatDate, formatMoney, useLedger } from "../data/client";
import type { Category, ReportStatus } from "../data/types";
import { CATEGORIES } from "../data/types";
import { Avatar, Card, PageHeader, StatusPill } from "../components/ui";

const TABS: { id: ReportStatus | "all"; label: string }[] = [
  { id: "all", label: "All reports" },
  { id: "submitted", label: "Awaiting approval" },
  { id: "approved", label: "Approved" },
  { id: "reimbursed", label: "Reimbursed" },
];

export function ReportsPage() {
  const { data } = useLedger();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const router = useRouter();
  const [tab, setTab] = useState<ReportStatus | "all">("all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [department, setDepartment] = useState<string>("all");
  const departments = [
    ...new Set(data.employees.map((e) => e.department)),
  ].sort();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.reports
      .filter((r) => tab === "all" || r.status === tab)
      .filter((r) => category === "all" || r.category === category)
      .filter((r) => department === "all" || r.department === department)
      .filter(
        (r) =>
          !needle ||
          `${r.id} ${r.title} ${r.employeeName} ${r.category}`
            .toLowerCase()
            .includes(needle),
      );
  }, [data.reports, tab, q, category, department]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Expense reports"
        subtitle={`${rows.length} of ${data.reports.length} reports`}
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          <div role="tablist" className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                data-action={`Tab: ${t.label}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[0.8rem] font-medium",
                  tab === t.id
                    ? "bg-brand-soft text-brand"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category | "all")}
              className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[0.8rem]"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              aria-label="Department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[0.8rem]"
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-1.5 text-[0.8rem]">
              <Search className="h-3.5 w-3.5 text-ink-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search reports"
                className="w-40 bg-transparent outline-none placeholder:text-ink-muted"
              />
            </label>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.82rem]">
            <thead className="text-[0.7rem] uppercase tracking-[0.05em] text-ink-muted">
              <tr className="border-b border-hairline">
                <th className="px-4 py-2 font-medium">Report</th>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Submitted</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hold = r.holds.find((h) => h.status === "open");
                return (
                  <tr
                    key={r.id}
                    data-action="Open report"
                    onClick={() => router.push(skinHref(`reports/${r.id}`))}
                    className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-muted"
                  >
                    <td className="min-w-[14rem] px-4 py-2.5">
                      <a
                        href={skinHref(`reports/${r.id}`)}
                        data-action="Open report"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          router.push(skinHref(`reports/${r.id}`));
                        }}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {r.title}
                      </a>
                      <div className="text-[0.7rem] text-ink-muted">
                        <span className="font-mono">{r.id}</span> · {r.category}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <Avatar name={r.employeeName} size="sm" />
                        {r.employeeName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">
                      {formatDate(r.submittedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatMoney(r.total)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={r.status} />
                        {hold ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-negative-soft px-1.5 py-0.5 text-[0.66rem] font-semibold text-negative">
                            <ShieldAlert className="h-3 w-3" /> Hold
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-ink-muted"
                  >
                    No reports here.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
