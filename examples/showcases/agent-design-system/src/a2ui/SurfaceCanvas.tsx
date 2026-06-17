"use client";

import { useEffect, useRef, useState } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { catalog } from "./catalog";
import { surfaceBus } from "./surface-bus";
import type { A2UIOp } from "./surface-bus";

const DEBUG = false;

if (DEBUG && typeof window !== "undefined") {
  console.log("[SurfaceCanvas:module] catalog import =", catalog);
}

export function SurfaceCanvas({
  channel,
  emptyState,
}: {
  channel: string;
  emptyState: React.ReactNode;
}) {
  if (DEBUG)
    console.log("[SurfaceCanvas] mount channel=", channel, "catalog=", catalog);
  return (
    <A2UIProvider catalog={catalog}>
      <CanvasInner channel={channel} emptyState={emptyState} />
    </A2UIProvider>
  );
}

function CanvasInner({
  channel,
  emptyState,
}: {
  channel: string;
  emptyState: React.ReactNode;
}) {
  const actions = useA2UIActions();
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const seenRef = useRef(0);
  const createdSurfacesRef = useRef<Set<string>>(new Set());

  function applyOps(ops: A2UIOp[]) {
    if (!ops.length) return;
    const out = ops.filter((op) => {
      const cs = op.createSurface as { surfaceId?: string } | undefined;
      if (cs?.surfaceId) {
        if (createdSurfacesRef.current.has(cs.surfaceId)) return false;
        createdSurfacesRef.current.add(cs.surfaceId);
      }
      return true;
    });
    if (DEBUG)
      console.log(
        "[SurfaceCanvas] applyOps — input=",
        ops.length,
        "filtered=",
        out.length,
        "ops=",
        out,
      );
    try {
      actions.processMessages(out as Record<string, unknown>[]);
      if (DEBUG) console.log("[SurfaceCanvas] processMessages OK");
    } catch (err) {
      console.warn("[SurfaceCanvas] processMessages threw:", err);
    }
  }

  useEffect(() => {
    if (DEBUG)
      console.log("[SurfaceCanvas] effect — subscribing channel=", channel);
    const initial = surfaceBus.snapshot(channel);
    if (DEBUG)
      console.log(
        "[SurfaceCanvas] initial snapshot — surfaceId=",
        initial.surfaceId,
        "ops.length=",
        initial.ops.length,
      );
    if (initial.ops.length) {
      applyOps(initial.ops);
      seenRef.current = initial.ops.length;
      setSurfaceId(initial.surfaceId);
    }
    return surfaceBus.subscribe(channel, (snap) => {
      if (DEBUG)
        console.log(
          "[SurfaceCanvas] bus notify — total ops=",
          snap.ops.length,
          "seen=",
          seenRef.current,
          "surfaceId=",
          snap.surfaceId,
        );
      const tail = snap.ops.slice(seenRef.current);
      if (tail.length) applyOps(tail);
      seenRef.current = snap.ops.length;
      if (snap.surfaceId) setSurfaceId(snap.surfaceId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, channel]);

  if (DEBUG) console.log("[SurfaceCanvas] render — surfaceId=", surfaceId);

  if (!surfaceId) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6">
        <A2UIRenderer surfaceId={surfaceId} />
      </div>
    </div>
  );
}
