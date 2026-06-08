"use client";

import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { catalog } from "./catalog";
import { surfaceBus } from "./surface-bus";
import type { A2UIOp } from "./surface-bus";

const DEBUG = false;

const ContentSchema = z.object({
  a2ui_operations: z.array(z.record(z.string(), z.unknown())),
});

type Content = z.infer<typeof ContentSchema>;

function getSurfaceId(ops: A2UIOp[]): string | undefined {
  for (const op of ops) {
    const cs = op.createSurface as { surfaceId?: string } | undefined;
    if (cs?.surfaceId) return cs.surfaceId;
    const uc = op.updateComponents as { surfaceId?: string } | undefined;
    if (uc?.surfaceId) return uc.surfaceId;
  }
  return undefined;
}

function InChatSurface({ channel, ops }: { channel: string; ops: A2UIOp[] }) {
  const surfaceId = useMemo(() => getSurfaceId(ops), [ops]);

  /* Push to bus regardless — canvas (if mounted) will read from there. */
  useEffect(() => {
    if (ops?.length) surfaceBus.push(channel, ops);
  }, [ops, channel]);

  /* Re-check on each render whether a canvas is subscribed. If yes, the
     canvas paints the surface; chat just shows a breadcrumb pill so it
     doesn't duplicate the dashboard. */
  const canvasMounted = surfaceBus.hasSubscribers(channel);

  if (!surfaceId) return null;

  if (canvasMounted) {
    return (
      <div className="my-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-[var(--line)] bg-[var(--surface-soft)] text-[12px] text-[var(--ink-2)]">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--accent)" }}
          aria-hidden
        />
        <span className="font-mono uppercase tracking-wider text-[10px] text-[var(--ink)]">
          surface
        </span>
        <span aria-hidden className="text-[var(--muted-2)]">
          →
        </span>
        <span>rendered in the canvas</span>
      </div>
    );
  }

  return (
    <div className="my-2 a2ui-surface">
      <A2UIProvider catalog={catalog}>
        <ProcessOps ops={ops} />
        <A2UIRenderer surfaceId={surfaceId} />
      </A2UIProvider>
    </div>
  );
}

function ProcessOps({ ops }: { ops: A2UIOp[] }) {
  const { processMessages, getSurface } = useA2UIActions();
  const lastHashRef = useRef<string>("");

  useEffect(() => {
    if (!ops?.length) return;
    const hash = JSON.stringify(ops);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    const filtered = ops.filter((op) => {
      const cs = op.createSurface as { surfaceId?: string } | undefined;
      if (!cs?.surfaceId) return true;
      return !getSurface(cs.surfaceId);
    });

    if (DEBUG)
      console.log(
        "[MirrorRenderer] processMessages — input=",
        ops.length,
        "filtered=",
        filtered.length,
      );

    if (!filtered.length) return;

    try {
      processMessages(filtered as Record<string, unknown>[]);
      if (DEBUG) console.log("[MirrorRenderer] processMessages OK");
    } catch (err) {
      console.warn("[MirrorRenderer] processMessages threw:", err);
    }
  }, [ops, processMessages, getSurface]);

  return null;
}

export function createMirrorActivityRenderer(
  channel: string,
): ReactActivityMessageRenderer<Content> {
  if (DEBUG)
    console.log(
      "[MirrorRenderer] createMirrorActivityRenderer registered for channel=",
      channel,
    );
  return {
    activityType: "a2ui-surface",
    content: ContentSchema,
    render: ({ content }) => {
      if (DEBUG)
        console.log(
          "[MirrorRenderer] activity-renderer.render fired for channel=",
          channel,
          "content keys=",
          Object.keys(content ?? {}),
          "ops=",
          content?.a2ui_operations,
        );
      return (
        <InChatSurface
          channel={channel}
          ops={(content.a2ui_operations as A2UIOp[]) ?? []}
        />
      );
    },
  };
}
