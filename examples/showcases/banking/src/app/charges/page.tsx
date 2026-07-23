"use client";
import { useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { Search, X } from "lucide-react";
import { CHARGES, CHARGE_CATEGORIES, CHARGE_STATUSES } from "./charges-data";
import type { Charge, ChargeStatus } from "./charges-data";
import { formatCurrency } from "@/lib/utils";

type SortKey = "amount_desc" | "amount_asc" | "date_desc" | "date_asc";
const SORT_LABELS: Record<SortKey, string> = {
  amount_desc: "Most expensive",
  amount_asc: "Least expensive",
  date_desc: "Newest first",
  date_asc: "Oldest first",
};

const STATUS_STYLES: Record<ChargeStatus, string> = {
  approved: "bg-positive-soft/70 text-positive",
  pending: "bg-brand-soft text-brand-indigo dark:text-brand-violet",
  flagged:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  "over-limit": "bg-negative-soft/70 text-negative",
};

export default function ChargesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // All filter state lives in the URL so the copilot can deep-link into a
  // pre-filtered, pre-sorted view (e.g. ?sort=amount_desc&top=10) and the
  // on-screen controls reflect exactly what it set.
  const sort = (searchParams.get("sort") as SortKey) || "amount_desc";
  const topRaw = searchParams.get("top");
  const top = topRaw && !Number.isNaN(Number(topRaw)) ? Number(topRaw) : null;
  const categories = (searchParams.get("category") ?? "")
    .split(",")
    .filter(Boolean);
  const statuses = (searchParams.get("status") ?? "")
    .split(",")
    .filter(Boolean);
  const vendor = searchParams.get("vendor") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const setParam = (key: string, value: string | string[] | null) => {
    const params = new URLSearchParams(searchParams.toString());
    const empty =
      value == null || value === "" || (Array.isArray(value) && !value.length);
    if (empty) params.delete(key);
    else params.set(key, Array.isArray(value) ? value.join(",") : value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggleIn = (key: string, list: string[], value: string) =>
    setParam(
      key,
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );

  const filters = { sort, top, categories, statuses, vendor, from, to };
  const anyFilter =
    categories.length ||
    statuses.length ||
    vendor ||
    from ||
    to ||
    top != null ||
    sort !== "amount_desc";

  const visible = useMemo(() => {
    let rows: Charge[] = CHARGES.filter((c) => {
      if (categories.length && !categories.includes(c.category)) return false;
      if (statuses.length && !statuses.includes(c.status)) return false;
      if (vendor && !c.merchant.toLowerCase().includes(vendor.toLowerCase()))
        return false;
      if (from && c.date < from) return false;
      if (to && c.date > to) return false;
      return true;
    });
    rows.sort((a, b) => {
      switch (sort) {
        case "amount_asc":
          return a.amount - b.amount;
        case "date_desc":
          return b.date.localeCompare(a.date);
        case "date_asc":
          return a.date.localeCompare(b.date);
        default:
          return b.amount - a.amount; // amount_desc
      }
    });
    return top != null ? rows.slice(0, top) : rows;
  }, [categories, statuses, vendor, from, to, sort, top]);

  const rankedByAmount = sort === "amount_desc" || sort === "amount_asc";
  const totalVisible = visible.reduce((s, c) => s + c.amount, 0);

  // Page awareness: expose the active filters and the exact rows on screen so
  // the officer can ask about what they're looking at.
  useAgentContext({
    description:
      "The Charges page the user is currently viewing: the active filters/sort and the visible (filtered + sorted) charge rows. Use this to answer questions about the charges on screen.",
    value: JSON.stringify({
      page: "charges",
      filters,
      visibleCount: visible.length,
      totalOnScreen: totalVisible,
      charges: visible.slice(0, 25),
    }),
  });

  return (
    <div className="space-y-5 px-2 pb-6 md:px-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">Charges</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {visible.length} of {CHARGES.length} charges ·{" "}
            {formatCurrency(totalVisible)} shown
          </p>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          {/* Sort */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Sort</span>
            <select
              value={sort}
              onChange={(e) => setParam("sort", e.target.value)}
              className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          {/* Top N */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Show</span>
            <select
              value={top ?? "all"}
              onChange={(e) =>
                setParam(
                  "top",
                  e.target.value === "all" ? null : e.target.value,
                )
              }
              className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="all">All</option>
              <option value="5">Top 5</option>
              <option value="10">Top 10</option>
              <option value="20">Top 20</option>
            </select>
          </label>

          {/* Vendor search */}
          <label className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5">
            <Search className="h-4 w-4 text-ink-muted" />
            <input
              value={vendor}
              onChange={(e) => setParam("vendor", e.target.value)}
              placeholder="Vendor"
              className="w-28 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />
          </label>

          {/* Date range */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setParam("from", e.target.value)}
              className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setParam("to", e.target.value)}
              className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>

          {anyFilter ? (
            <button
              type="button"
              onClick={() => router.replace(pathname, { scroll: false })}
              className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-brand-soft hover:text-brand-indigo"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          ) : null}
        </div>

        {/* Category chips */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Category
          </span>
          {CHARGE_CATEGORIES.map((cat) => {
            const on = categories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleIn("category", categories, cat)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? "border-brand bg-brand text-white"
                    : "border-hairline bg-surface text-ink-muted hover:border-brand hover:text-brand-indigo"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Status chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Status
          </span>
          {CHARGE_STATUSES.map((st) => {
            const on = statuses.includes(st);
            return (
              <button
                key={st}
                type="button"
                onClick={() => toggleIn("status", statuses, st)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  on
                    ? "border-brand bg-brand text-white"
                    : "border-hairline bg-surface text-ink-muted hover:border-brand hover:text-brand-indigo"
                }`}
              >
                {st}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Merchant</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Team</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => (
                <tr
                  key={c.id}
                  className="border-b border-hairline/60 last:border-0 hover:bg-brand-soft/30"
                >
                  <td className="px-4 py-3 font-mono text-ink-muted tabular-nums">
                    {rankedByAmount ? i + 1 : "·"}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {c.merchant}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{c.category}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.team}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">
                    {c.date}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                    {formatCurrency(c.amount)}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-ink-muted"
                  >
                    No charges match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
