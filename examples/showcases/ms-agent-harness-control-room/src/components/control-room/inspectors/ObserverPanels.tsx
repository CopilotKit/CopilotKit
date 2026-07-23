"use client";

/**
 * Inspector cards backed by Harness's observer feeds. Each of these is a
 * **live wrapper** in the Notion-doc sense — the underlying telemetry is
 * populated by the agent's tool plumbing rather than a native AG-UI event
 * stream — so every card carries the compact `<PrimitiveWrapperBadge />`.
 *
 * `FeatureAutodetectPanel` is the native one (it reads `useCapabilities`)
 * and intentionally omits the badge.
 */

import { PrimitiveWrapperBadge } from "@/components/control-room/PrimitiveWrapperBadge";
import {
  useControlRoomAgentState,
  useControlRoomLocal,
} from "@/hooks/use-control-room-state";
import type { ControlRoomObserverSnapshotDto } from "@/lib/control-room-types";

function ObserverCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cr-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="cr-heading">{title}</h3>
        <PrimitiveWrapperBadge />
      </div>
      {children}
    </div>
  );
}

export function RepoObserverPanel() {
  const agentState = useControlRoomAgentState();
  const observers = agentState.observers ?? null;
  return (
    <ObserverCard title="Repo observer">
      <dl className="cr-dl">
        <dt>Files tracked</dt>
        <dd>{observers?.repo_file_count ?? "—"}</dd>
      </dl>
      <p
        className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Recent paths via `observer_snapshot` tool
      </p>
    </ObserverCard>
  );
}

export function TestObserverPanel() {
  const agentState = useControlRoomAgentState();
  const observers: ControlRoomObserverSnapshotDto | null =
    agentState.observers ?? null;
  return (
    <ObserverCard title="Test observer">
      <dl className="cr-dl">
        <dt>Command</dt>
        <dd>{observers?.latest_test_command ?? "—"}</dd>
        <dt>Success</dt>
        <dd>
          {observers?.latest_test_success == null
            ? "—"
            : observers.latest_test_success
              ? "yes"
              : "no"}
        </dd>
      </dl>
    </ObserverCard>
  );
}

export function ToolObserverPanel() {
  return (
    <ObserverCard title="Tool observer">
      <p
        className="text-[10px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Tool-call summaries surface inline in the workstream when fired
      </p>
    </ObserverCard>
  );
}

export function StateObserverPanel() {
  return (
    <ObserverCard title="State observer">
      <p
        className="text-[10px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Latest snapshot validity reports through `observer_snapshot`
      </p>
    </ObserverCard>
  );
}

export function FeatureAutodetectPanel() {
  const { localState } = useControlRoomLocal();
  const support = localState.featureSupport as {
    native?: string[];
    live_wrappers?: string[];
  } | null;
  return (
    <div className="cr-card">
      <h3 className="cr-heading mb-2">Feature autodetection</h3>
      {!support ? (
        <p
          className="text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Awaiting capability handshake…
        </p>
      ) : (
        <>
          <FeatureList label="Native" items={support.native ?? []} />
          <div className="mt-3">
            <FeatureList
              label="Live wrappers"
              items={support.live_wrappers ?? []}
            />
          </div>
        </>
      )}
    </div>
  );
}

function FeatureList({ label, items }: { label: string; items: string[] }) {
  const safe = Array.isArray(items) ? items : [];
  return (
    <div>
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cr-muted-2)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        {label}
      </div>
      {safe.length === 0 ? (
        <p
          className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          (none)
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {safe.map((item) => (
            <li
              key={item}
              className="cr-chip"
              style={{ fontSize: "9.5px" }}
              data-tone={label === "Native" ? "emerald" : undefined}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ObserverPanels() {
  return (
    <>
      <RepoObserverPanel />
      <TestObserverPanel />
      <ToolObserverPanel />
      <StateObserverPanel />
      <FeatureAutodetectPanel />
    </>
  );
}
