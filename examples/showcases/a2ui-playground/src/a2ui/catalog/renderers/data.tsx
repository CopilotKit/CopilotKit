"use client";

import { useMemo, type ReactNode } from "react";
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  MapPin,
  Minus,
  Search,
  Star,
  X,
  icons,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { asArray, formatNumber } from "./format";
import type { RendererMap } from "./types";

/* ---------------------------------------------------------------- tones */

export type Tone = "default" | "positive" | "negative" | "warning" | "info" | "accent";

/** Literal class strings per tone (kept literal so Tailwind picks them up). */
export const TONE: Record<Tone, { text: string; soft: string; solid: string; outline: string; dot: string; bar: string; color: string }> = {
  default: {
    text: "text-foreground/85",
    soft: "bg-white/[0.06] text-foreground/85 border-white/[0.08]",
    solid: "bg-foreground/90 text-background border-transparent",
    outline: "border-white/[0.14] text-foreground/85 bg-transparent",
    dot: "bg-muted-foreground",
    bar: "[&_[data-slot=progress-indicator]]:bg-foreground/70",
    color: "var(--muted-foreground)",
  },
  positive: {
    text: "text-(--a2-positive)",
    soft: "bg-[color-mix(in_oklch,var(--a2-positive)_13%,transparent)] text-(--a2-positive) border-[color-mix(in_oklch,var(--a2-positive)_24%,transparent)]",
    solid: "bg-(--a2-positive) text-black/80 border-transparent",
    outline: "border-[color-mix(in_oklch,var(--a2-positive)_45%,transparent)] text-(--a2-positive) bg-transparent",
    dot: "bg-(--a2-positive)",
    bar: "[&_[data-slot=progress-indicator]]:bg-(--a2-positive)",
    color: "var(--a2-positive)",
  },
  negative: {
    text: "text-(--a2-negative)",
    soft: "bg-[color-mix(in_oklch,var(--a2-negative)_13%,transparent)] text-(--a2-negative) border-[color-mix(in_oklch,var(--a2-negative)_24%,transparent)]",
    solid: "bg-(--a2-negative) text-black/80 border-transparent",
    outline: "border-[color-mix(in_oklch,var(--a2-negative)_45%,transparent)] text-(--a2-negative) bg-transparent",
    dot: "bg-(--a2-negative)",
    bar: "[&_[data-slot=progress-indicator]]:bg-(--a2-negative)",
    color: "var(--a2-negative)",
  },
  warning: {
    text: "text-(--a2-warning)",
    soft: "bg-[color-mix(in_oklch,var(--a2-warning)_13%,transparent)] text-(--a2-warning) border-[color-mix(in_oklch,var(--a2-warning)_24%,transparent)]",
    solid: "bg-(--a2-warning) text-black/80 border-transparent",
    outline: "border-[color-mix(in_oklch,var(--a2-warning)_45%,transparent)] text-(--a2-warning) bg-transparent",
    dot: "bg-(--a2-warning)",
    bar: "[&_[data-slot=progress-indicator]]:bg-(--a2-warning)",
    color: "var(--a2-warning)",
  },
  info: {
    text: "text-(--a2-info)",
    soft: "bg-[color-mix(in_oklch,var(--a2-info)_13%,transparent)] text-(--a2-info) border-[color-mix(in_oklch,var(--a2-info)_24%,transparent)]",
    solid: "bg-(--a2-info) text-black/80 border-transparent",
    outline: "border-[color-mix(in_oklch,var(--a2-info)_45%,transparent)] text-(--a2-info) bg-transparent",
    dot: "bg-(--a2-info)",
    bar: "[&_[data-slot=progress-indicator]]:bg-(--a2-info)",
    color: "var(--a2-info)",
  },
  accent: {
    text: "text-(--a2-accent)",
    soft: "bg-[color-mix(in_oklch,var(--a2-accent)_14%,transparent)] text-(--a2-accent) border-[color-mix(in_oklch,var(--a2-accent)_26%,transparent)]",
    solid: "bg-(--a2-accent) text-black/80 border-transparent",
    outline: "border-[color-mix(in_oklch,var(--a2-accent)_45%,transparent)] text-(--a2-accent) bg-transparent",
    dot: "bg-(--a2-accent)",
    bar: "[&_[data-slot=progress-indicator]]:bg-(--a2-accent)",
    color: "var(--a2-accent)",
  },
};

export function toneOf(t: unknown, fallback: Tone = "default"): Tone {
  return typeof t === "string" && t in TONE ? (t as Tone) : fallback;
}

/** Guess a tone from a status word, for badge-formatted table cells. */
function toneFromText(text: string): Tone {
  const s = text.toLowerCase();
  if (/(paid|active|done|complete|success|healthy|online|approved|shipped|live|won|pass)/.test(s)) return "positive";
  if (/(fail|overdue|error|declined|cancel|churn|lost|blocked|down|critical)/.test(s)) return "negative";
  if (/(pending|trial|review|waiting|draft|at risk|due|paused|late)/.test(s)) return "warning";
  if (/(enterprise|pro|scale|premium)/.test(s)) return "accent";
  if (/(new|info|beta|starter)/.test(s)) return "info";
  return "default";
}

/* ---------------------------------------------------------------- shared bits */

/** Resolve a kebab-case lucide icon name ("trending-up") to its component. */
export function iconFor(name?: string): LucideIcon | undefined {
  if (!name || typeof name !== "string") return undefined;
  const key = name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
  return (icons as Record<string, LucideIcon>)[key];
}

function str(v: unknown): string {
  return v == null ? "" : typeof v === "object" ? "" : String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.+-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, n));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Non-narrowing object check for `.filter`, keeps the element type. */
const ok = (v: unknown): boolean => isObj(v);

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Stable hue per name so initials avatars are distinguishable. */
function hueOf(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function CardTitle({ title, right }: { title?: string; right?: ReactNode }) {
  if (!title && !right) return null;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      {title ? <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">{title}</h3> : <span />}
      {right}
    </div>
  );
}

function trendOf(delta?: string, trend?: string) {
  return (trend ?? (delta?.trim().startsWith("-") ? "down" : delta ? "up" : undefined)) as "up" | "down" | "flat" | undefined;
}

/**
 * A KPI value that never breaks inside a token ("$84.2k" stays whole).
 * The parent is an inline-size container; the font scales with it (cqi) from
 * the value's length, between 14px and `max`. Phrases (a model putting words
 * in a KPI) wrap only at spaces.
 */
function KpiValue({ value, max, className }: { value: unknown; max: number; className?: string }) {
  const text = typeof value === "number" ? formatNumber(value) : str(value);
  const longest = Math.max(1, ...text.split(/\s+/).map((w) => w.length));
  const phrase = text.includes(" ") && text.length > 14;
  const fit = (100 / (0.62 * Math.max(phrase ? longest + 2 : text.length, 4))).toFixed(2);
  return (
    <span
      className={cn("min-w-0 max-w-full font-semibold leading-[1.1] tracking-tight tabular-nums", phrase ? "whitespace-normal [overflow-wrap:normal] [word-break:keep-all]" : "whitespace-nowrap", className)}
      style={{ fontSize: `clamp(14px, ${fit}cqi, ${phrase ? Math.min(max, 18) : max}px)` }}
    >
      {phrase ? (
        text
      ) : (
        // transitions.dev number pop-in: each glyph rises in, --digit-stagger apart.
        <span key={text} className="t-digit-group is-animating" aria-label={text}>
          {Array.from(text).map((ch, i) => (
            <span key={i} className="t-digit" aria-hidden style={{ "--i": i } as React.CSSProperties}>
              {ch === " " ? "\u00a0" : ch}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function Delta({ delta, trend }: { delta?: string; trend?: string }) {
  if (!delta) return null;
  const t = trendOf(delta, trend);
  const TrendIcon = t === "down" ? ArrowDownRight : t === "flat" ? Minus : ArrowUpRight;
  const tone: Tone = t === "down" ? "negative" : t === "flat" ? "default" : "positive";
  return (
    <span className={cn("inline-flex min-w-0 items-start gap-0.5 text-[12px] font-medium leading-tight tabular-nums", tone === "default" ? "text-muted-foreground" : TONE[tone].text)}>
      <TrendIcon className="mt-px size-3.5 flex-none" />
      {delta}
    </span>
  );
}

/* ---------------------------------------------------------------- dates */

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function fmtDate(v: unknown) {
  const d = parseDate(v);
  return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d) : str(v);
}

/* ---------------------------------------------------------------- DataTable */

type Row = Record<string, unknown>;
type Col = { key: string; label: string; format?: "text" | "number" | "currency" | "percent" | "badge" | "date"; align?: "left" | "right" };

const tableFeats = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  filterFns: { includesString: filterFn_includesString },
});

const NUMERIC = new Set(["number", "currency", "percent"]);
const EMPTY_ROWS: Row[] = [];

function formatCell(value: unknown, format: Col["format"], fraction = false): ReactNode {
  if (value == null || value === "") return <span className="text-muted-foreground/50">-</span>;
  switch (format) {
    case "number":
      return formatNumber(typeof value === "number" ? value : num(value, NaN), "number");
    case "currency":
      return typeof value === "number" ? formatNumber(value, "currency") : str(value);
    case "percent":
      return typeof value === "number" ? formatNumber(fraction ? value * 100 : value, "percent") : str(value);
    case "date":
      return fmtDate(value);
    case "badge": {
      const text = str(value);
      return (
        <Badge variant="outline" className={cn("h-5 rounded-full px-2 text-[11px] font-medium", TONE[toneFromText(text)].soft)}>
          {text}
        </Badge>
      );
    }
    default:
      return str(value);
  }
}

function DataTableView({ title, columns, rows, searchable, pageSize }: { title?: string; columns: Col[]; rows: Row[]; searchable?: boolean; pageSize: number }) {
  const cols = useMemo<ColumnDef<typeof tableFeats, Row>[]>(
    () =>
      columns.map((c) => {
        const numeric = NUMERIC.has(c.format ?? "");
        // Percent columns written as fractions (0.124) are shown as 12.4%.
        const vals = rows.map((r) => r[c.key]).filter((v): v is number => typeof v === "number");
        const fraction = c.format === "percent" && vals.length > 0 && vals.every((v) => Math.abs(v) <= 1);
        return {
          id: c.key,
          accessorFn: (row: Row) => {
            const v = row[c.key];
            if (numeric && typeof v === "string") {
              const n = num(v, NaN);
              return Number.isFinite(n) ? n : v;
            }
            if (c.format === "date") return parseDate(v)?.getTime() ?? str(v);
            return v as never;
          },
          header: c.label,
          cell: (ctx) => formatCell(ctx.row.original[c.key], c.format, fraction),
          sortFn: numeric || c.format === "date" ? "basic" : "alphanumeric",
          sortUndefined: "last",
        } satisfies ColumnDef<typeof tableFeats, Row>;
      }),
    [columns, rows],
  );

  const table = useTable({
    features: tableFeats,
    columns: cols,
    data: rows,
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: () => true,
    initialState: { pagination: { pageIndex: 0, pageSize }, sorting: [], globalFilter: "" },
  });

  const filtered = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: size } = table.state.pagination;
  const pageCount = Math.max(1, table.getPageCount());
  const from = filtered === 0 ? 0 : pageIndex * size + 1;
  const to = Math.min(filtered, (pageIndex + 1) * size);
  const showPager = rows.length > size;

  return (
    <div className="a2-card a2-enter flex w-full min-w-0 flex-col overflow-hidden">
      {title || searchable ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3.5 pb-3">
          <div className="flex min-w-0 items-baseline gap-2">
            {title ? <h3 className="truncate text-[13px] font-semibold tracking-tight">{title}</h3> : null}
            <span className="text-[11px] text-muted-foreground tabular-nums">{rows.length} rows</span>
          </div>
          {searchable ? (
            <div className="relative w-full max-w-56 min-w-0">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={String(table.state.globalFilter ?? "")}
                onChange={(e) => table.setGlobalFilter(e.target.value)}
                placeholder="Search rows"
                aria-label="Search rows"
                className="h-7.5 rounded-lg pl-8 text-[12.5px]"
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={cn("min-w-0 border-(--a2-line)", (title || searchable) && "border-t")}>
        <Table className="text-[13px]">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="border-(--a2-line) hover:bg-transparent">
                {group.headers.map((header) => {
                  const col = columns.find((c) => c.key === header.column.id);
                  const right = col?.align ? col.align === "right" : NUMERIC.has(col?.format ?? "");
                  const sorted = header.column.getIsSorted();
                  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
                  return (
                    <TableHead key={header.id} className={cn("h-9 bg-white/[0.015] px-4 text-[11.5px] font-medium text-muted-foreground", right && "text-right")}>
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "group/sort inline-flex items-center gap-1 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                          right && "flex-row-reverse",
                          sorted && "text-foreground",
                        )}
                      >
                        <table.FlexRender header={header} />
                        <SortIcon className={cn("size-3 shrink-0 transition-opacity", sorted ? "opacity-90" : "opacity-0 group-hover/sort:opacity-50")} />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="border-(--a2-line) hover:bg-white/[0.025]">
                {row.getAllCells().map((cell) => {
                  const col = columns.find((c) => c.key === cell.column.id);
                  const right = col?.align ? col.align === "right" : NUMERIC.has(col?.format ?? "");
                  return (
                    <TableCell key={cell.id} className={cn("h-10 px-4 py-2 tabular-nums", right ? "text-right" : "text-foreground/90", col === columns[0] && "font-medium text-foreground")}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {filtered === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={Math.max(1, columns.length)} className="h-20 text-center text-[12.5px] text-muted-foreground">
                  {rows.length === 0 ? "No rows yet" : "No rows match your search"}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {showPager ? (
        <div className="flex items-center justify-between gap-3 border-t border-(--a2-line) px-4 py-2">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {from}-{to} of {filtered}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
              <ChevronLeft />
            </Button>
            <span className="min-w-12 text-center text-[11px] text-muted-foreground tabular-nums">
              {pageIndex + 1} / {pageCount}
            </span>
            <Button variant="ghost" size="icon-xs" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- RadialProgress */

function Ring({ value, tone, size = 76, stroke = 7, children }: { value: number; tone: Tone; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = clamp(value);
  const color = tone === "default" ? "var(--a2-accent)" : TONE[tone].color;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--a2-line-strong)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1)", filter: `drop-shadow(0 0 6px color-mix(in oklch, ${color} 35%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}


/* ---------------------------------------------------------------- renderers */

type DataKeys =
  | "Stat"
  | "StatGroup"
  | "Avatar"
  | "AvatarGroup"
  | "DataTable"
  | "KeyValueList"
  | "Timeline"
  | "Progress"
  | "RadialProgress"
  | "Rating"
  | "TagList"
  | "Agenda"
  | "ComparisonTable";

export const dataRenderers: RendererMap<DataKeys> = {
  Stat: ({ props }) => {
    const tone = toneOf(props.tone);
    const Icon = iconFor(props.icon);
    return (
      <div className="a2-card a2-enter @container flex w-full min-w-0 flex-1 flex-col gap-2 px-4 py-3.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-[12px] font-medium text-muted-foreground">{str(props.label)}</span>
          {Icon ? (
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border", tone === "default" ? "border-white/[0.08] bg-white/[0.04] text-muted-foreground" : TONE[tone].soft)}>
              <Icon className="size-3.5" />
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <KpiValue value={props.value} max={26} className={cn(tone !== "default" && TONE[tone].text)} />
          <Delta delta={props.delta} trend={props.trend} />
        </div>
        {props.caption ? <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground/80">{props.caption}</span> : null}
      </div>
    );
  },

  StatGroup: ({ props }) => {
    const items = asArray<Record<string, unknown>>(props.items).filter(ok);
    return (
      <div className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-px bg-(--a2-line)">
          {items.map((it, i) => (
            <div key={i} className="@container flex min-w-0 flex-col gap-1.5 bg-(--a2-surface) px-4 py-3.5">
              <span className="truncate text-[12px] font-medium text-muted-foreground">{str(it.label)}</span>
              <KpiValue value={it.value} max={22} />
              <Delta delta={typeof it.delta === "string" ? it.delta : undefined} trend={typeof it.trend === "string" ? it.trend : undefined} />
            </div>
          ))}
          {items.length === 0 ? <div className="h-20 bg-(--a2-surface)" /> : null}
        </div>
      </div>
    );
  },

  Avatar: ({ props }) => {
    const name = str(props.name) || "Unknown";
    const size = props.size ?? "md";
    const hue = hueOf(name);
    return (
      <div className="a2-enter flex min-w-0 items-center gap-2.5">
        <Avatar size={size === "md" ? "default" : size} className={cn(size === "lg" && "size-11")}>
          {props.image ? <AvatarImage src={props.image} alt={name} /> : null}
          <AvatarFallback
            className={cn("font-medium", size === "lg" ? "text-[14px]" : size === "sm" ? "text-[10px]" : "text-[12px]")}
            style={{ background: `oklch(0.32 0.06 ${hue})`, color: `oklch(0.9 0.06 ${hue})` }}
          >
            {initials(name)}
          </AvatarFallback>
          {props.status ? (
            <AvatarBadge
              aria-label={props.status}
              className={cn(props.status === "online" ? "bg-(--a2-positive)" : props.status === "away" ? "bg-(--a2-warning)" : "bg-muted-foreground/60")}
            />
          ) : null}
        </Avatar>
        {props.name || props.subtitle ? (
          <div className="flex min-w-0 flex-col">
            <span className={cn("truncate font-medium text-foreground", size === "lg" ? "text-[14px]" : "text-[13px]")}>{name}</span>
            {props.subtitle ? <span className="truncate text-[11.5px] text-muted-foreground">{props.subtitle}</span> : null}
          </div>
        ) : null}
      </div>
    );
  },

  AvatarGroup: ({ props }) => {
    const people = asArray<{ name?: string; image?: string }>(props.people).filter(ok);
    const max = Math.max(1, props.max ?? 5);
    const shown = people.slice(0, max);
    const extra = people.length - shown.length;
    return (
      <TooltipProvider delayDuration={120}>
        <div className="a2-enter flex min-w-0 items-center gap-3">
          <AvatarGroup className="*:data-[slot=avatar]:ring-(--a2-surface) -space-x-1.5">
            {shown.map((p, i) => {
              const name = str(p.name) || "Guest";
              const hue = hueOf(name);
              return (
                <Tooltip key={`${name}-${i}`}>
                  <TooltipTrigger asChild>
                    <Avatar className="size-8 ring-2 transition-transform hover:z-10 hover:-translate-y-0.5">
                      {p.image ? <AvatarImage src={p.image} alt={name} /> : null}
                      <AvatarFallback className="text-[11px] font-medium" style={{ background: `oklch(0.32 0.06 ${hue})`, color: `oklch(0.9 0.06 ${hue})` }}>
                        {initials(name)}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>{name}</TooltipContent>
                </Tooltip>
              );
            })}
            {extra > 0 ? <AvatarGroupCount className="size-8 text-[11px] font-medium tabular-nums ring-(--a2-surface)">+{extra}</AvatarGroupCount> : null}
          </AvatarGroup>
          {props.label ? <span className="truncate text-[12.5px] text-muted-foreground">{props.label}</span> : null}
        </div>
      </TooltipProvider>
    );
  },

  DataTable: ({ props }) => {
    const columns = useMemo(
      () => asArray<Col>(props.columns).filter((c) => isObj(c) && typeof c.key === "string").map((c) => ({ ...c, label: str(c.label) || c.key })),
      [props.columns],
    );
    const raw = props.rows;
    const rows = useMemo(() => {
      const list = asArray<Row>(raw).filter(ok);
      return list.length ? list : EMPTY_ROWS;
    }, [raw]);
    const pageSize = Math.max(1, Math.round(props.pageSize ?? 8));
    return <DataTableView title={props.title} columns={columns} rows={rows} searchable={props.searchable} pageSize={pageSize} />;
  },

  KeyValueList: ({ props }) => {
    const items = asArray<{ label?: string; value?: unknown; hint?: string }>(props.items).filter(ok);
    const cols = clamp(Math.round(props.columns ?? 1), 1, 3);
    return (
      <div className="a2-card a2-enter @container flex w-full min-w-0 flex-col gap-2 px-4 py-3.5">
        <CardTitle title={props.title} />
        <dl className={cn("grid min-w-0 gap-x-6", cols === 2 && "@md:grid-cols-2", cols === 3 && "@md:grid-cols-2 @2xl:grid-cols-3")}>
          {items.map((it, i) => (
            <div
              key={i}
              className="grid min-w-0 grid-cols-1 gap-0.5 border-b border-dashed border-(--a2-line) py-2 last:border-b-0 @[16rem]:grid-cols-[minmax(0,auto)_minmax(0,1fr)] @[16rem]:items-baseline @[16rem]:gap-4"
            >
              <dt className="min-w-0 text-[12.5px] text-muted-foreground">{str(it.label)}</dt>
              <dd className="flex min-w-0 flex-col @[16rem]:items-end @[16rem]:text-right">
                <span className="min-w-0 break-words text-[13px] font-medium text-foreground tabular-nums">{typeof it.value === "number" ? formatNumber(it.value) : str(it.value)}</span>
                {it.hint ? <span className="text-[11px] text-muted-foreground/80">{it.hint}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  },

  Timeline: ({ props }) => {
    const items = asArray<{ title?: string; time?: string; description?: string; status?: string; icon?: string }>(props.items).filter(ok);
    return (
      <div className="a2-card a2-enter w-full min-w-0 px-4 py-4">
        <ol className="flex flex-col">
          {items.map((it, i) => {
            const status = it.status ?? "done";
            const last = i === items.length - 1;
            const Icon = iconFor(it.icon);
            return (
              <li key={i} className="relative flex min-w-0 gap-3.5">
                <div className="relative flex w-5 shrink-0 justify-center">
                  {!last ? (
                    <span
                      aria-hidden
                      className={cn("absolute top-6 -bottom-0.5 w-px", status === "done" ? "bg-[color-mix(in_oklch,var(--a2-positive)_45%,transparent)]" : "bg-(--a2-line-strong)")}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 mt-0.5 grid size-5 place-items-center rounded-full border",
                      status === "done" && "border-transparent bg-[color-mix(in_oklch,var(--a2-positive)_18%,transparent)] text-(--a2-positive)",
                      status === "current" && "border-(--a2-accent) bg-[color-mix(in_oklch,var(--a2-accent)_16%,transparent)] text-(--a2-accent) shadow-[0_0_0_4px_color-mix(in_oklch,var(--a2-accent)_12%,transparent)]",
                      status === "upcoming" && "border-(--a2-line-strong) bg-(--a2-surface) text-muted-foreground",
                    )}
                  >
                    {Icon ? (
                      <Icon className="size-3" />
                    ) : status === "done" ? (
                      <Check className="size-3" strokeWidth={2.75} />
                    ) : status === "current" ? (
                      <span className="size-1.5 rounded-full bg-(--a2-accent)" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>
                </div>
                <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", !last && "pb-4.5")}>
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className={cn("truncate text-[13px] font-medium", status === "upcoming" ? "text-foreground/65" : "text-foreground")}>{str(it.title)}</span>
                    {it.time ? <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{it.time}</span> : null}
                  </div>
                  {it.description ? <p className="text-[12.5px] leading-relaxed text-muted-foreground">{it.description}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  },

  Progress: ({ props }) => {
    const v = clamp(num(props.value));
    const tone = toneOf(props.tone, "accent");
    return (
      <div className="a2-enter flex w-full min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="truncate text-[12.5px] font-medium text-foreground/90">{props.label ? str(props.label) : null}</span>
          <span className="shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">{Math.round(v)}%</span>
        </div>
        <Progress value={v} className={cn("h-1.5 bg-white/[0.07]", TONE[tone].bar)} />
        {props.caption ? <span className="text-[11px] text-muted-foreground/80">{props.caption}</span> : null}
      </div>
    );
  },

  RadialProgress: ({ props }) => {
    const v = clamp(num(props.value));
    const tone = toneOf(props.tone, "accent");
    return (
      <div className="a2-card a2-enter flex w-full min-w-0 items-center gap-4 px-4 py-3.5">
        <Ring value={v} tone={tone}>
          <span className="text-[17px] font-semibold tracking-tight tabular-nums">{props.display ? str(props.display) : `${Math.round(v)}%`}</span>
        </Ring>
        <div className="flex min-w-0 flex-col gap-1">
          {props.label ? <span className="truncate text-[13px] font-medium text-foreground">{str(props.label)}</span> : null}
          <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(v)} of 100</span>
        </div>
      </div>
    );
  },

  Rating: ({ props }) => {
    const v = clamp(num(props.value), 0, 5);
    return (
      <div className="a2-enter flex min-w-0 flex-col gap-1.5">
        {props.label ? <span className="text-[12px] font-medium text-muted-foreground">{props.label}</span> : null}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex items-center gap-0.5" role="img" aria-label={`${v} out of 5 stars`}>
            {[0, 1, 2, 3, 4].map((i) => {
              const fill = clamp((v - i) * 100);
              return (
                <span key={i} className="relative size-4">
                  <Star className="absolute inset-0 size-4 fill-white/[0.08] text-white/[0.12]" strokeWidth={1.5} />
                  <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill}%` }}>
                    <Star className="size-4 fill-(--a2-warning) text-(--a2-warning)" strokeWidth={1.5} />
                  </span>
                </span>
              );
            })}
          </div>
          <span className="text-[13px] font-semibold tabular-nums">{v.toFixed(1)}</span>
          {props.count != null ? <span className="text-[11.5px] text-muted-foreground tabular-nums">{formatNumber(props.count)} reviews</span> : null}
        </div>
      </div>
    );
  },

  TagList: ({ props }) => {
    const tags = asArray<unknown>(props.tags).map(str).filter(Boolean);
    const tone = toneOf(props.tone);
    return (
      <div className="a2-enter flex w-full min-w-0 flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <Badge key={`${t}-${i}`} variant="outline" className={cn("h-6 max-w-full rounded-md px-2 text-[12px] font-normal", TONE[tone].soft)}>
            <span className="truncate">{t}</span>
          </Badge>
        ))}
      </div>
    );
  },

  Agenda: ({ props }) => {
    const days = asArray<{ date?: string; label?: string; events?: unknown }>(props.days).filter(ok);
    return (
      <div className="a2-card a2-enter flex w-full min-w-0 flex-col">
        {props.title ? (
          <div className="border-b border-(--a2-line) px-4 py-3">
            <CardTitle title={props.title} />
          </div>
        ) : null}
        <div className="flex flex-col divide-y divide-(--a2-line)">
          {days.map((day, di) => {
            const d = parseDate(day.date);
            const events = asArray<{ time?: string; title?: string; speaker?: string; location?: string; description?: string; tone?: string }>(day.events).filter(ok);
            const weekday = d ? new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d) : "";
            const month = d ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(d) : "";
            return (
              <div key={di} className="flex min-w-0 gap-4 px-4 py-3.5">
                <div className="flex w-12 shrink-0 flex-col items-center pt-0.5">
                  <span className="a2-label text-center leading-tight">{day.label ?? weekday}</span>
                  <span className="text-[22px] font-semibold leading-tight tracking-tight tabular-nums">{d ? d.getDate() : str(day.date)}</span>
                  {d ? <span className="text-[11px] text-muted-foreground">{month}</span> : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {events.length === 0 ? <span className="py-2 text-[12.5px] text-muted-foreground">Nothing scheduled</span> : null}
                  {events.map((ev, ei) => {
                    const tone = toneOf(ev.tone, "accent");
                    return (
                      <div key={ei} className="a2-well flex min-w-0 items-stretch gap-3 px-3 py-2">
                        <span className={cn("w-0.5 shrink-0 rounded-full", TONE[tone].dot)} />
                        <span className="w-16 shrink-0 pt-px text-[11.5px] font-medium text-muted-foreground tabular-nums">{ev.time ?? "All day"}</span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[13px] font-medium text-foreground">{str(ev.title)}</span>
                          {ev.speaker ? <span className="truncate text-[11.5px] text-muted-foreground">{ev.speaker}</span> : null}
                          {ev.description ? <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{ev.description}</span> : null}
                          {ev.location ? (
                            <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                              <MapPin className="size-3 shrink-0" />
                              <span className="truncate">{ev.location}</span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },

  ComparisonTable: ({ props }) => {
    const options = asArray<unknown>(props.options).map(str);
    const rows = asArray<{ feature?: string; values?: unknown }>(props.rows).filter(ok);
    const hl = typeof props.highlight === "number" ? props.highlight : -1;
    const hlCell = "bg-[color-mix(in_oklch,var(--a2-accent)_7%,transparent)]";
    return (
      <div className="a2-card a2-enter flex w-full min-w-0 flex-col overflow-hidden">
        {props.title ? (
          <div className="px-4 pt-3.5 pb-3">
            <CardTitle title={props.title} />
          </div>
        ) : null}
        <Table className={cn("text-[13px]", props.title && "border-t border-(--a2-line)")}>
          <TableHeader>
            <TableRow className="border-(--a2-line) hover:bg-transparent">
              <TableHead className="h-auto px-4 py-3 align-bottom text-[11.5px] font-medium text-muted-foreground">Feature</TableHead>
              {options.map((o, i) => (
                <TableHead key={i} className={cn("h-auto px-3 py-3 text-center align-bottom", i === hl && cn(hlCell, "shadow-[inset_0_2px_0_var(--a2-accent)]"))}>
                  <div className="flex flex-col items-center gap-1">
                    {i === hl ? (
                      <Badge variant="outline" className={cn("h-5 rounded-full px-2 text-[11px] font-medium", TONE.accent.soft)}>
                        Recommended
                      </Badge>
                    ) : null}
                    <span className={cn("text-[12.5px] font-semibold", i === hl ? "text-foreground" : "text-foreground/80")}>{o}</span>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, ri) => {
              const values = asArray<unknown>(r.values);
              return (
                <TableRow key={ri} className="border-(--a2-line) hover:bg-white/[0.02]">
                  <TableCell className="px-4 py-2.5 text-[12.5px] whitespace-normal text-foreground/85">{str(r.feature)}</TableCell>
                  {options.map((_, ci) => {
                    const v = values[ci];
                    return (
                      <TableCell key={ci} className={cn("px-3 py-2.5 text-center tabular-nums", ci === hl && hlCell)}>
                        {v === true ? (
                          <span className="inline-grid size-5 place-items-center rounded-full bg-[color-mix(in_oklch,var(--a2-positive)_16%,transparent)] text-(--a2-positive)">
                            <Check className="size-3" strokeWidth={3} aria-label="Yes" />
                          </span>
                        ) : v === false ? (
                          <X className="inline size-3.5 text-muted-foreground/45" aria-label="No" />
                        ) : v == null || v === "" ? (
                          <span className="text-muted-foreground/40">-</span>
                        ) : (
                          <span className="text-[12.5px] text-foreground/90">{typeof v === "number" ? formatNumber(v) : str(v)}</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  },

};
