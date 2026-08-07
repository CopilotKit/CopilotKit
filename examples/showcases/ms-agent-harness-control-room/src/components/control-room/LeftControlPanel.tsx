"use client";

/**
 * Left column: control surfaces (endpoint, mode, fixture reset, reconnect,
 * approval queue, command quick-reference).
 */

import { useState } from "react";

import { ApprovalQueue } from "@/components/control-room/ApprovalQueue";
import { CommandControls } from "@/components/control-room/CommandControls";
import { EndpointSelector } from "@/components/control-room/EndpointSelector";
import { ModeControls } from "@/components/control-room/ModeControls";
import { StructuredOutputControl } from "@/components/control-room/StructuredOutputControl";
import { useControlRoomLocal } from "@/hooks/use-control-room-state";
import type { FixtureResetResult } from "@/lib/control-room-types";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";

export function LeftControlPanel() {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <EndpointSelector />
      <ModeControls />
      <CommandControls />
      <StructuredOutputControl />
      <FixtureResetControl />
      <ReconnectControl />
      <ApprovalQueue />
    </div>
  );
}

function FixtureResetControl() {
  const { localState } = useControlRoomLocal();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FixtureResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/fixture/reset", {
        method: "POST",
        headers: {
          [CONTROL_ROOM_ENDPOINT_HEADER]: localState.currentEndpoint,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult((await response.json()) as FixtureResetResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="cr-heading mb-2">Fixture</h3>
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="cr-btn w-full"
      >
        {busy ? "Resetting…" : "Reset fixture repo"}
      </button>
      {result ? (
        <p
          className="mt-2 text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {result.reset
            ? `Reset OK · ${result.file_count} file${result.file_count === 1 ? "" : "s"}`
            : "Reset reported no-op."}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-2 text-[10.5px] text-[var(--cr-red)]"
          role="alert"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReconnectControl() {
  const { localState, bumpReconnect } = useControlRoomLocal();
  return (
    <div>
      <h3 className="cr-heading mb-2">Connection</h3>
      <button
        type="button"
        onClick={bumpReconnect}
        className="cr-btn w-full"
        data-variant="ghost"
      >
        Reconnect
      </button>
      <p
        className="mt-2 text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Reconnect attempts · {localState.reconnectAttempts}
      </p>
    </div>
  );
}
