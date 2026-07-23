"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthContext } from "@/components/auth-context";
import { useInspector } from "@/lib/inspector/store";
import type { PanelMemory } from "@/lib/intelligence/memory";

// Backstop only; the real trigger is a memory-kind event in the store.
const BACKSTOP_POLL_MS = 15_000;

/** The over-limit unlock is saved as project-scope, operational (Intelligence main's memory-kind enum). */
function isOverLimitProcedure(m: PanelMemory): boolean {
  return m.scope === "project" && m.kind === "operational";
}

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

export function LearningTab() {
  const { currentUser } = useAuthContext();
  const role = currentUser?.role;
  const memberId = currentUser?.id;
  const { cards } = useInspector();

  const [procedures, setProcedures] = useState<PanelMemory[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchProcedures = useCallback(async () => {
    try {
      const res = await fetch("/api/memories", {
        headers: {
          Accept: "application/json",
          ...(role ? { "x-northwind-role": role } : {}),
          ...(memberId ? { "x-northwind-user-id": memberId } : {}),
        },
      });
      if (res.status === 503) {
        if (isMountedRef.current) {
          setDisabled(true);
          setLoaded(true);
        }
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json: unknown = await res.json();
      if (isMountedRef.current) {
        setProcedures(parseMemories(json).filter(isOverLimitProcedure));
        setDisabled(false);
        setLoaded(true);
      }
    } catch {
      if (isMountedRef.current) setLoaded(true);
    }
  }, [role, memberId]);

  const memoryEvents = cards.filter((c) => c.kind === "memory");

  // Fetch on mount + slow backstop poll. fetchProcedures is async — it setStates
  // only after `await fetch`, so there is no synchronous cascading render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState is post-await
    fetchProcedures().catch(() => {});
    const handle = window.setInterval(
      () => fetchProcedures().catch(() => {}),
      BACKSTOP_POLL_MS,
    );
    return () => window.clearInterval(handle);
  }, [fetchProcedures]);

  // Event-driven: re-fetch the moment a memory tool-call streams in.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState is post-await
    if (memoryEvents.length > 0) fetchProcedures().catch(() => {});
  }, [memoryEvents.length, fetchProcedures]);

  const learned = procedures.length > 0;

  if (disabled) {
    return (
      <div className="p-4 text-xs text-ink-muted">
        <p className="font-medium text-ink">Requires Intelligence mode</p>
        <p className="mt-1">
          Durable self-learning needs the Intelligence backend. Set the
          <code className="mx-1 rounded bg-surface-muted px-1">
            INTELLIGENCE_*
          </code>{" "}
          env vars to enable it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${learned ? "bg-positive" : "bg-ink-muted"}`}
          />
          <h3 className="text-xs font-semibold text-ink">
            Over-limit procedure — {learned ? "learned" : "not yet learned"}
          </h3>
        </div>
        {!loaded ? (
          <p className="text-[11px] text-ink-muted">Loading…</p>
        ) : learned ? (
          <ul className="flex flex-col gap-1.5">
            {procedures.map((p) => (
              <li
                key={p.id}
                className="rounded border border-positive/40 bg-positive-soft p-2 text-[11px]"
              >
                <p className="text-ink">{p.content}</p>
                <p className="mt-1 text-[10px] text-ink-muted">
                  learned from {p.sourceThreadIds.length}{" "}
                  {p.sourceThreadIds.length === 1 ? "thread" : "threads"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded border border-hairline p-2 text-[11px] text-ink-muted">
            No saved over-limit procedure yet. Ask the copilot to approve an
            over-limit charge — it will stall, offer to record, and you teach it
            by demonstrating the policy exception. Once saved, it appears here
            and a fresh thread recalls it.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-ink">
          Recall activity (this session)
        </h3>
        {memoryEvents.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            No memory tool calls yet. Recall/save events appear here as the
            agent uses long-term memory.
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {memoryEvents.map((c) => (
              <li
                key={c.id}
                className="rounded border border-hairline px-2 py-1 text-[11px] text-ink"
              >
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-positive align-middle" />
                {c.title}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
