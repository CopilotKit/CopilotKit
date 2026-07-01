"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import useCreditCards from "@/app/actions";
import { catalog } from "@/a2ui/catalog";
import { surfaceBus } from "@/a2ui/surface-bus";
import { ReportDataProvider } from "@/a2ui/report-data";

const CHANNEL = "default";

export function ReportCanvas() {
  const { transactions, policies } = useCreditCards();
  return (
    <ReportDataProvider value={{ transactions, policies }}>
      <A2UIProvider catalog={catalog}>
        <CanvasInner />
      </A2UIProvider>
    </ReportDataProvider>
  );
}

function CanvasInner() {
  const actions = useA2UIActions();
  const seenRef = useRef(0);
  const createdRef = useRef<Set<string>>(new Set());
  const surfaceIdRef = useRef<string | null>(null);

  function applyOps(ops: Array<Record<string, unknown>>) {
    if (!ops.length) return;
    // MessageProcessor throws on duplicate createSurface — strip dupes.
    const out = ops.filter((op) => {
      const cs = op.createSurface as { surfaceId?: string } | undefined;
      if (cs?.surfaceId) {
        if (createdRef.current.has(cs.surfaceId)) return false;
        createdRef.current.add(cs.surfaceId);
      }
      return true;
    });
    try {
      actions.processMessages(out);
    } catch (err) {
      console.warn("[report-canvas] processMessages threw:", err);
    }
  }

  useEffect(() => {
    const initial = surfaceBus.snapshot(CHANNEL);
    if (initial.ops.length) applyOps(initial.ops);
    seenRef.current = initial.ops.length;
    surfaceIdRef.current = initial.surfaceId;
    return surfaceBus.subscribe(CHANNEL, (snap) => {
      const tail = snap.ops.slice(seenRef.current);
      if (tail.length) applyOps(tail);
      seenRef.current = snap.ops.length;
      surfaceIdRef.current = snap.surfaceId;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  const surfaceId = surfaceBus.snapshot(CHANNEL).surfaceId;
  if (!surfaceId) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8">
        <A2UIRenderer surfaceId={surfaceId} />
      </div>
    </div>
  );
}
