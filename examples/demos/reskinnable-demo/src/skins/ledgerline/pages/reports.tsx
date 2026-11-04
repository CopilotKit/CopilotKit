"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { formatDate, useLedger } from "../data/client";
import type { Category, ReportStatus } from "../data/types";
import { CATEGORIES } from "../data/types";
import {
  Avatar,
  Chip,
  Id,
  Money,
  PageHeader,
  StatusPill,
  rowLink,
  td,
  th,
} from "../components/ui";

const TABS: { id: ReportStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Awaiting approval" },
  { id: "approved", label: "Approved" },
  { id: "reimbursed", label: "Reimbursed" },
  { id: "draft", label: "Drafts" },
];

const select =
  "h-8 rounded-md border border-hairline bg-surface px-2 text-[13px] text-ink outline-none transition-colors hover:border-[hsl(225_10%_82%)] focus:border-brand";

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
  const count = (id: ReportStatus | "all") =>
    id === "all"
      ? data.reports.length
      : data.reports.filter((r) => r.status === id).length;

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title="Expense reports"
        subtitle={
          <span className="ll-num">
            {rows.length} of {data.reports.length} reports,{" "}
            <Money value={rows.reduce((a, r) => a + r.total, 0)} />
          </span>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
                "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors",
                tab === t.id
                  ? "bg-brand-soft font-medium text-brand-indigo"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {t.label}
              <span className="ll-num text-[11.5px] text-[hsl(var(--ll-faint))]">
                {count(t.id)}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category | "all")}
            className={select}
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
            className={select}
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="flex h-8 w-52 items-center gap-2 rounded-md border border-hairline px-2.5 text-[13px] focus-within:border-brand">
            <Search className="h-3.5 w-3.5 text-[hsl(var(--ll-faint))]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter reports"
              aria-label="Filter reports"
              className="ll-noring min-w-0 flex-1 bg-transparent outline-none placeholder:text-[hsl(var(--ll-faint))]"
            />
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Report</th>
              <th className={th}>Employee</th>
              <th className={th}>Submitted</th>
              <th className={th}>Status</th>
              <th className={cn(th, "text-right")}>Amount</th>
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
                  className={rowLink}
                >
                  <td className={cn(td, "min-w-[14rem]")}>
                    <Link
                      href={skinHref(`reports/${r.id}`)}
                      data-action="Open report"
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:text-brand"
                    >
                      {r.title}
                    </Link>
                    <div className="text-[11.5px] text-[hsl(var(--ll-faint))]">
                      <Id>{r.id}</Id> {r.category}
                    </div>
                  </td>
                  <td className={td}>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={r.employeeName} size="sm" />{" "}
                      {r.employeeName}
                    </span>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-ink-muted")}>
                    {formatDate(r.submittedAt)}
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusPill status={r.status} />
                      {hold ? (
                        <Chip tone="red">
                          <ShieldAlert className="h-3 w-3" /> {hold.code}
                        </Chip>
                      ) : null}
                    </span>
                  </td>
                  <td className={cn(td, "text-right font-medium")}>
                    <Money value={r.total} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-[13px] text-ink-muted"
                >
                  No reports match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
