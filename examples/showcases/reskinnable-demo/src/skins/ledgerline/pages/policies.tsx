"use client";

import { useEffect, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { API } from "../data/client";
import type { PolicyDoc } from "../data/types";
import { Card, PageHeader } from "../components/ui";

/** The policy library: the same documents the agent's searchPolicies reads. */
export function PoliciesPage() {
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch(
        `${API}/policies${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as {
        results: PolicyDoc[];
        note?: string;
      };
      setDocs(body.results);
      setNote(body.note ?? null);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Policies"
        subtitle="Travel & Expense Policy, Approvals Handbook and Budget Ownership Guide"
        actions={
          <label className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[0.8rem]">
            <Search className="h-3.5 w-3.5 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the policy library"
              className="w-56 bg-transparent outline-none placeholder:text-ink-muted"
            />
          </label>
        }
      />
      {note ? (
        <p className="mb-3 text-[0.78rem] text-ink-muted">{note}</p>
      ) : null}
      <div className="space-y-3">
        {docs.map((d) => (
          <Card key={d.id} className="px-4 py-3">
            <div className="flex items-center gap-2 text-[0.72rem] text-ink-muted">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="font-mono">{d.id}</span>
              <span>{d.title}</span>
              <span className="ml-auto">Updated {d.updatedAt}</span>
            </div>
            <h2 className="mt-1 text-[0.92rem] font-semibold">{d.section}</h2>
            <p className="mt-0.5 text-[0.82rem]">{d.summary}</p>
            <p className="mt-1 text-[0.78rem] text-ink-muted">{d.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
