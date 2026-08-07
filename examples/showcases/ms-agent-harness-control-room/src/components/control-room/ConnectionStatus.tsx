"use client";

/**
 * Connection-health indicator. Self-managed `HttpAgent` instances don't ship
 * AG-UI capability discovery, so this component probes the agent's `/health`
 * endpoint directly. A 2xx response flips the pip to ONLINE; anything else
 * leaves it CONNECTING until the next poll.
 */

import { useEffect, useState } from "react";

import { useControlRoomLocal } from "@/hooks/use-control-room-state";

type ProbeStatus = "idle" | "loading" | "ok";

const STATUS_TONE: Record<ProbeStatus, "amber" | "emerald" | undefined> = {
  idle: undefined,
  loading: "amber",
  ok: "emerald",
};

const STATUS_LABEL: Record<ProbeStatus, string> = {
  idle: "STANDBY",
  loading: "CONNECTING",
  ok: "ONLINE",
};

const HEALTH_POLL_MS = 4000;

export function ConnectionStatus() {
  const { localState, setFeatureSupport, recordConnection } =
    useControlRoomLocal();
  const { currentEndpoint, reconnectAttempts } = localState;
  const [status, setStatus] = useState<ProbeStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const probe = async () => {
      try {
        const url = currentEndpoint.replace(/\/?$/, "/health");
        const res = await fetch(url, { method: "GET", cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          setStatus("ok");
          recordConnection("connected");
          // No native capability discovery for self-managed agents — flag
          // the well-known wrapper feature set so the inspector's autodetect
          // tile renders something useful.
          setFeatureSupport({
            native: [
              "TodoListProvider",
              "AgentModeProvider",
              "FileAccessProvider",
              "FileMemoryProvider",
              "ToolApprovalAgent",
              "AgentSkillsProvider",
            ],
            live_wrappers: [
              "RepoObserver",
              "TestObserver",
              "ToolObserver",
              "StateObserver",
              "pnpm_run",
            ],
          });
        } else {
          setStatus("loading");
        }
      } catch {
        if (cancelled) return;
        setStatus("loading");
      }
    };
    void probe();
    const id = window.setInterval(probe, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentEndpoint, reconnectAttempts, recordConnection, setFeatureSupport]);

  return (
    <div className="flex items-center justify-between gap-3 border border-[var(--cr-border-strong)] bg-[var(--cr-surface-3)] px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="cr-pip" data-tone={STATUS_TONE[status]} />
        <div className="min-w-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--cr-fg-strong)]"
            style={{ fontFamily: "var(--cr-font-mono)" }}
          >
            {STATUS_LABEL[status]}
          </div>
          <div
            className="truncate text-[10.5px] text-[var(--cr-muted-2)]"
            style={{ fontFamily: "var(--cr-font-mono)" }}
            title={currentEndpoint}
          >
            {currentEndpoint}
          </div>
        </div>
      </div>
    </div>
  );
}
