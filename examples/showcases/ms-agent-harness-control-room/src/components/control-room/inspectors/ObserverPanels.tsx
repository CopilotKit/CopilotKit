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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function ObserverCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          <PrimitiveWrapperBadge />
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
      <p className="mt-2 text-xs text-muted-foreground">
        Recent paths come from Harness file-access events.
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
      <p className="text-xs text-muted-foreground">
        Tool-call summaries appear inline in the workstream when fired.
      </p>
    </ObserverCard>
  );
}

export function StateObserverPanel() {
  return (
    <ObserverCard title="State observer">
      <p className="text-xs text-muted-foreground">
        Snapshot status comes from the latest Harness state and tool events.
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
    <Card size="sm">
      <CardHeader>
        <CardTitle>Feature autodetection</CardTitle>
        <CardDescription>
          Capabilities exposed by the current endpoint.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!support ? (
          <p className="text-xs text-muted-foreground">
            Awaiting capability handshake.
          </p>
        ) : (
          <div className="space-y-3">
            <FeatureList label="Native" items={support.native ?? []} />
            <FeatureList
              label="Live wrappers"
              items={support.live_wrappers ?? []}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeatureList({ label, items }: { label: string; items: string[] }) {
  const safe = Array.isArray(items) ? items : [];
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {safe.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          None reported.
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {safe.map((item) => (
            <li key={item}>
              <Badge
                variant="outline"
                className={
                  label === "Native"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : undefined
                }
              >
                {item}
              </Badge>
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
