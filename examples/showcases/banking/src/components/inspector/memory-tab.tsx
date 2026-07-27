"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthContext } from "@/components/auth-context";
import { useInspector } from "@/lib/inspector/store";
import type { PanelMemory } from "@/lib/intelligence/memory";

// Backstop only — the primary refresh trigger is a memory-kind event landing in
// the store (see the memoryEventCount effect). Catches rare out-of-band changes.
const BACKSTOP_POLL_MS = 15_000;

const KIND_COLORS: Record<string, string> = {
  topical: "bg-brand-soft text-brand-indigo",
  episodic: "bg-brand-soft text-brand-violet",
  operational: "bg-positive-soft text-positive",
};
const SCOPE_COLORS: Record<string, string> = {
  user: "bg-surface-muted text-ink-muted",
  project: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function parseMemories(value: unknown): PanelMemory[] {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { memories?: unknown }).memories)
  ) {
    return (value as { memories: PanelMemory[] }).memories;
  }
  return [];
}

function MemoryCard({
  memory,
  relevance,
}: {
  memory: PanelMemory;
  relevance?: number;
}) {
  const kindColor =
    KIND_COLORS[memory.kind] ?? "bg-surface-muted text-ink-muted";
  const scopeColor =
    SCOPE_COLORS[memory.scope] ?? "bg-surface-muted text-ink-muted";
  const threadCount = memory.sourceThreadIds.length;
  return (
    <li className="flex flex-col gap-1 rounded border border-hairline p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kindColor}`}
        >
          {memory.kind}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${scopeColor}`}
        >
          {memory.scope}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink">{memory.content}</p>
      {relevance !== undefined && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-brand-indigo"
            style={{ width: `${Math.max(6, Math.round(relevance * 100))}%` }}
          />
        </div>
      )}
      <div className="text-[10px] text-ink-muted">
        {threadCount} {threadCount === 1 ? "source thread" : "source threads"}
      </div>
    </li>
  );
}

function DisabledState() {
  return (
    <div className="p-4 text-xs text-ink-muted">
      <p className="font-medium text-ink">Requires Intelligence mode</p>
      <p className="mt-1">
        Durable memory lives in the Intelligence backend. Set the
        <code className="mx-1 rounded bg-surface-muted px-1">
          INTELLIGENCE_*
        </code>
        env vars (see the README) to enable the memory store and recall.
      </p>
    </div>
  );
}

export function MemoryTab() {
  const { currentUser } = useAuthContext();
  const role = currentUser?.role;
  const memberId = currentUser?.id;

  // The store's memory-kind cards are our change signal: memory only changes
  // when the agent saves/recalls, which is exactly when these events fire.
  const { cards } = useInspector();
  const memoryEventCount = useMemo(
    () => cards.filter((c) => c.kind === "memory").length,
    [cards],
  );

  const [memories, setMemories] = useState<PanelMemory[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const [recallQuery, setRecallQuery] = useState("");
  const [recallResults, setRecallResults] = useState<PanelMemory[] | null>(
    null,
  );
  const [recallError, setRecallError] = useState<string | null>(null);
  const [isRecalling, setIsRecalling] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const headers = useCallback(
    (extra?: Record<string, string>) => ({
      Accept: "application/json",
      ...(role ? { "x-northwind-role": role } : {}),
      ...(memberId ? { "x-northwind-user-id": memberId } : {}),
      ...extra,
    }),
    [role, memberId],
  );

  const fetchList = useCallback(async () => {
    try {
      const response = await fetch("/api/memories", { headers: headers() });
      if (response.status === 503) {
        if (isMountedRef.current) {
          setDisabled(true);
          setHasLoadedOnce(true);
        }
        return;
      }
      if (!response.ok) throw new Error(`recall failed (${response.status})`);
      const json: unknown = await response.json();
      if (isMountedRef.current) {
        setMemories(parseMemories(json));
        setDisabled(false);
        setListError(null);
        setHasLoadedOnce(true);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setListError(err instanceof Error ? err.message : "unknown error");
        setHasLoadedOnce(true);
      }
    }
  }, [headers]);

  // Fetch on mount + a slow backstop poll for rare out-of-band changes.
  // fetchList is async — it setStates only after `await fetch`, so there is no
  // synchronous cascading render (what the rule guards against).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState is post-await
    fetchList().catch(() => {});
    const handle = window.setInterval(
      () => fetchList().catch(() => {}),
      BACKSTOP_POLL_MS,
    );
    return () => window.clearInterval(handle);
  }, [fetchList]);

  // Event-driven refresh: re-fetch the instant a memory tool-call streams in.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState is post-await
    if (memoryEventCount > 0) fetchList().catch(() => {});
  }, [memoryEventCount, fetchList]);

  const runRecall = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return;
      setIsRecalling(true);
      setRecallError(null);
      try {
        const response = await fetch("/api/memories/recall", {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ query: trimmed }),
        });
        if (!response.ok) throw new Error(`recall failed (${response.status})`);
        const json: unknown = await response.json();
        if (isMountedRef.current) setRecallResults(parseMemories(json));
      } catch (err) {
        if (isMountedRef.current) {
          setRecallError(err instanceof Error ? err.message : "unknown error");
          setRecallResults(null);
        }
      } finally {
        if (isMountedRef.current) setIsRecalling(false);
      }
    },
    [headers],
  );

  const maxScore =
    recallResults && recallResults.length > 0
      ? Math.max(...recallResults.map((m) => m.score ?? 0))
      : 0;

  if (disabled) return <DisabledState />;

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <h3 className="text-xs font-semibold text-ink">Memory store</h3>
        <p className="text-[10px] text-ink-muted">
          Long-term memory. Updates as the agent saves and recalls.
        </p>
      </div>

      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          runRecall(recallQuery).catch(() => {});
        }}
      >
        <input
          type="text"
          placeholder="Recall by meaning…"
          value={recallQuery}
          onChange={(e) => setRecallQuery(e.target.value)}
          aria-label="Recall memories by meaning"
          className="flex-1 rounded border border-hairline bg-transparent px-2 py-1 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={isRecalling || recallQuery.trim().length === 0}
          className="rounded border border-hairline px-2 py-1 text-xs font-medium text-ink hover:bg-brand-soft disabled:opacity-40"
        >
          {isRecalling ? "…" : "Recall"}
        </button>
      </form>

      {recallResults !== null && (
        <section aria-label="Recall results">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">
              Semantic recall ({recallResults.length})
            </h3>
            <button
              type="button"
              onClick={() => {
                setRecallResults(null);
                setRecallError(null);
              }}
              className="text-[10px] text-ink-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
          {recallError ? (
            <p className="text-[11px] text-negative">
              Recall failed: {recallError}
            </p>
          ) : recallResults.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              No memories matched that query.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recallResults.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  relevance={
                    maxScore > 0 ? (m.score ?? 0) / maxScore : undefined
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-label="Recalled memories">
        {/* "Recalled", NOT "All": this is top-k semantic recall, not a complete
            enumeration. No absolute count — the UI must not claim completeness. */}
        <h3 className="mb-1.5 text-xs font-semibold text-ink">
          Recalled memories
        </h3>
        {listError ? (
          <p className="text-[11px] text-negative">
            Unable to load memories: {listError}
          </p>
        ) : !hasLoadedOnce ? (
          <p className="text-[11px] text-ink-muted">Loading…</p>
        ) : memories.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            Nothing recalled yet. Teach the agent a durable procedure and watch
            it appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {memories.map((m) => (
              <MemoryCard key={m.id} memory={m} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
