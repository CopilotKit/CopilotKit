"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { API, useLedger } from "../data/client";
import type { PolicyDoc } from "../data/types";
import { Chip, Id, PageHeader, td, th } from "../components/ui";
import { cn } from "@/lib/utils";
import { emitScreenContext } from "../learning/recorder";
import { POLICY_RULES } from "./policy-rules";

/**
 * Policies: the policy engine's rules (POL-*) and the handbook. The rules'
 * text is screen-only; the agent's searchPolicies reads the handbook.
 */
export function PoliciesPage() {
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch(
        `${API}/policies${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as { results: PolicyDoc[] };
      setDocs(body.results);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const rules = POLICY_RULES.filter(
    (r) =>
      !q.trim() ||
      `${r.id} ${r.title} ${r.text}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader
        title="Policies"
        subtitle="Rules the policy engine enforces, and the handbook behind them"
        actions={
          <label className="flex h-8 w-[260px] items-center gap-2 rounded-md border border-hairline px-2.5 text-[13px]">
            <Search className="h-3.5 w-3.5 text-[hsl(var(--ll-faint))]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter policies"
              aria-label="Filter policies"
              className="flex-1 bg-transparent outline-none placeholder:text-[hsl(var(--ll-faint))]"
            />
          </label>
        }
      />
      <h2 className="mb-2 text-[13px] font-semibold">Policy engine rules</h2>
      <div className="mb-8 overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Rule</th>
              <th className={th}>Applies to</th>
              <th className={th}>Hold status</th>
              <th className={th}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="hover:bg-surface-muted/60">
                <td className={td}>
                  <Link
                    href={skinHref(`policies/${r.id}`)}
                    data-action={`Open policy ${r.id}`}
                    className="flex items-center gap-2 font-medium hover:text-brand"
                  >
                    <Id>{r.id}</Id> {r.title}
                  </Link>
                </td>
                <td className={cn(td, "text-ink-muted")}>{r.appliesTo}</td>
                <td className={td}>
                  <Chip>{r.status}</Chip>
                </td>
                <td className={cn(td, "text-ink-muted")}>{r.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mb-2 text-[13px] font-semibold">Handbook</h2>
      <ul className="divide-y divide-hairline border-y border-hairline">
        {docs.map((d) => (
          <li key={d.id} className="grid grid-cols-[110px_1fr] gap-4 py-3.5">
            <Id className="pt-0.5">{d.id}</Id>
            <div>
              <div className="text-[13px] font-medium">
                {d.title} <span className="text-ink-muted">{d.section}</span>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-muted">{d.summary}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PolicyDetailPage({ policyId }: { policyId: string }) {
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const { data } = useLedger();
  const rule = POLICY_RULES.find((r) => r.id === policyId.toUpperCase());
  const emitted = useRef(false);
  const held = rule
    ? data.reports.filter((r) =>
        r.holds.some((h) => h.code === rule.id && h.status === "open"),
      )
    : [];

  // What the person reads here is the rule itself: captured as screen.context.
  useEffect(() => {
    if (!rule || emitted.current) return;
    emitted.current = true;
    emitScreenContext(`Policy ${rule.id}: ${rule.text}`, {
      policyId: rule.id,
      title: rule.title,
      text: rule.text,
    });
  }, [rule]);

  if (!rule)
    return (
      <div className="py-16 text-center text-[13px] text-ink-muted">
        There is no policy {policyId}.
      </div>
    );
  return (
    <div className="mx-auto max-w-[860px]">
      <Link
        href={skinHref("policies")}
        data-action="Back to policies"
        className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Policies
      </Link>
      <div className="mb-1 flex items-center gap-2">
        <Id className="text-[13px]">{rule.id}</Id>
        <Chip>{rule.status}</Chip>
      </div>
      <h1 className="text-[22px] font-semibold tracking-[-0.015em]">
        {rule.title}
      </h1>
      <blockquote
        data-testid="policy-text"
        className="my-6 border-y border-hairline py-5 text-[18px] leading-relaxed tracking-[-0.01em] text-ink"
      >
        {rule.text}
      </blockquote>
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
        <dt className="text-[hsl(var(--ll-faint))]">Applies to</dt>
        <dd>{rule.appliesTo}</dd>
        <dt className="text-[hsl(var(--ll-faint))]">Owner</dt>
        <dd>{rule.owner}</dd>
        <dt className="text-[hsl(var(--ll-faint))]">Effective</dt>
        <dd>{rule.effective}</dd>
        <dt className="text-[hsl(var(--ll-faint))]">Holding now</dt>
        <dd className="flex flex-wrap gap-2">
          {held.length
            ? held.map((r) => (
                <Link
                  key={r.id}
                  href={skinHref(`reports/${r.id}`)}
                  data-action="Open held report"
                  className="hover:text-brand"
                >
                  <Id>{r.id}</Id> {r.title}
                </Link>
              ))
            : "No reports"}
        </dd>
      </dl>
    </div>
  );
}
