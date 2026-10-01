"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Landmark, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Ledger } from "../data/types";
import { Money } from "./ui";

/**
 * ⌘K: jump to a report, a person's reports, a cost center or a page. Keyboard
 * first (arrows, Enter, Esc); the header's search field opens it too.
 */
interface Item {
  id: string;
  group: "Pages" | "Reports" | "People" | "Cost centers";
  label: string;
  meta?: React.ReactNode;
  href: string;
}

const PAGES: [string, string][] = [
  ["Overview", ""],
  ["Expense reports", "reports"],
  ["Approvals", "approvals"],
  ["Reimbursements", "reimbursements"],
  ["Cost centers", "cost-centers"],
  ["People", "people"],
  ["Policies", "policies"],
];

interface PaletteProps {
  onClose: () => void;
  data: Ledger;
  href: (path?: string) => string;
}

/** Mounted only while open, so every opening starts with an empty query. */
export function CommandPalette({
  open,
  ...rest
}: PaletteProps & { open: boolean }) {
  return open ? <Palette {...rest} /> : null;
}

function Palette({ onClose, data, href }: PaletteProps) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const all: Item[] = [
      ...PAGES.map(([label, seg]) => ({
        id: `p-${seg}`,
        group: "Pages" as const,
        label,
        href: href(seg),
      })),
      ...data.reports.map((r) => ({
        id: r.id,
        group: "Reports" as const,
        label: `${r.title}`,
        meta: (
          <>
            <span className="ll-mono">{r.id}</span> · {r.employeeName} ·{" "}
            <Money value={r.total} />
          </>
        ),
        href: href(`reports/${r.id}`),
      })),
      ...data.employees.map((e) => ({
        id: e.id,
        group: "People" as const,
        label: e.name,
        meta: e.title,
        href: href("people"),
      })),
      ...data.costCenters.map((c) => ({
        id: c.id,
        group: "Cost centers" as const,
        label: c.name,
        meta: <span className="ll-mono">{c.id}</span>,
        href: href("cost-centers"),
      })),
    ];
    const hit = (i: Item) =>
      !needle ||
      `${i.label} ${i.id} ${typeof i.meta === "string" ? i.meta : ""}`
        .toLowerCase()
        .includes(needle) ||
      (i.group === "Reports" &&
        data.reports
          .find((r) => r.id === i.id)
          ?.employeeName.toLowerCase()
          .includes(needle));
    const found = all.filter(hit);
    return needle
      ? found.slice(0, 12)
      : [
          ...found.filter((i) => i.group === "Pages"),
          ...found.filter((i) => i.group === "Reports").slice(0, 5),
        ];
  }, [q, data, href]);

  const go = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    router.push(i.href);
  };
  let lastGroup = "";
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[hsl(225_20%_10%/0.18)] pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Ledgerline"
        className="w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-hairline bg-surface"
        style={{ boxShadow: "var(--ll-shadow)" }}
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-hairline px-4">
          <Search className="h-4 w-4 text-[hsl(var(--ll-faint))]" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(items.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") go(items[cursor]);
            }}
            placeholder="Search reports, people, cost centers"
            aria-label="Search"
            className="ll-noring h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-[hsl(var(--ll-faint))]"
          />
          <kbd className="rounded border border-hairline px-1.5 text-[11px] text-ink-muted">
            esc
          </kbd>
        </div>
        <ul className="max-h-[360px] overflow-y-auto py-1.5" role="listbox">
          {items.map((i, n) => {
            const header = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            const Icon =
              i.group === "Reports"
                ? FileText
                : i.group === "People"
                  ? User
                  : i.group === "Cost centers"
                    ? Landmark
                    : CornerDownLeft;
            return (
              <li key={i.group + i.id}>
                {header ? (
                  <div className="px-4 pb-1 pt-2 text-[11px] font-medium text-[hsl(var(--ll-faint))]">
                    {header}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={n === cursor}
                  onMouseEnter={() => setCursor(n)}
                  onClick={() => go(i)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left text-[13px]",
                    n === cursor && "bg-brand-soft",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      n === cursor
                        ? "text-brand"
                        : "text-[hsl(var(--ll-faint))]",
                    )}
                  />
                  <span className="flex-1 truncate font-medium">{i.label}</span>
                  {i.meta ? (
                    <span className="truncate text-[12px] text-ink-muted">
                      {i.meta}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-[13px] text-ink-muted">
              Nothing matches &ldquo;{q}&rdquo;.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
