"use client";

import { useEffect, useRef } from "react";
import { A2UIRenderer, useA2UIActions } from "@copilotkit/a2ui-renderer";

/**
 * DELIBERATE DUPLICATE: `src/skins/exec/blocks/build-block-ops.ts` exports its
 * own `BLOCK_SURFACE_PREFIX` (the spelling the exec skin's op-builder uses to
 * MINT block surface ids). This is the shell's read-side copy, used only to
 * RECOGNIZE a block surface among activity content. The shell must not import
 * from `src/skins/` — skins are plugins the shell doesn't know about — so the
 * two constants are kept in sync by hand rather than shared.
 */
const BLOCK_SURFACE_PREFIX = "block:";

/** Minimal shape of an A2UI operation carrying a surfaceId. */
type A2UIOp = Record<string, unknown>;

/**
 * Defensively read `content["a2ui_operations"]` and walk the ops for the
 * first createSurface/updateComponents/updateDataModel surfaceId. Returns it
 * only if it is a block surface (the exec skin's block dashboard); returns
 * null for anything else (e.g. banking/report surfaces, which the canvas
 * keeps), and null for malformed content.
 */
export function blockSurfaceIdFrom(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const operations = (content as Record<string, unknown>)["a2ui_operations"];
  if (!Array.isArray(operations)) return null;

  for (const op of operations as A2UIOp[]) {
    if (!op || typeof op !== "object") continue;
    const target = (op.createSurface ??
      op.updateComponents ??
      op.updateDataModel) as { surfaceId?: string } | undefined;
    if (target?.surfaceId) {
      return target.surfaceId.startsWith(BLOCK_SURFACE_PREFIX)
        ? target.surfaceId
        : null;
    }
  }
  return null;
}

/**
 * Feeds the surface's operations into the AMBIENT a2ui store — no
 * `A2UIProvider` here, `CopilotKitProvider` already supplies one (wired with
 * `skin.catalog` in `src/app/[skin]/layout.tsx`). The activity content
 * carries the FULL operation list on each snapshot, so we strip a duplicate
 * createSurface once the surface exists (the MessageProcessor throws on it)
 * and skip re-processing identical op lists. Copied from banking's
 * `SurfaceMessageProcessor` (src/skins/banking/canvas-surface.tsx).
 */
function InlineBlockMessageProcessor({
  operations,
  surfaceId,
}: {
  operations: A2UIOp[];
  surfaceId: string;
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const lastHashRef = useRef("");

  useEffect(() => {
    if (!operations.length) return;
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;
    try {
      processMessages(ops as Array<Record<string, unknown>>);
    } catch (err) {
      console.warn("[inline-block-surface] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

/**
 * The shell's inline chat renderer for exec block surfaces — a small,
 * self-contained card that renders a single block dashboard tile inline in
 * the transcript. Unlike the banking/report and OGUI activity types (which
 * hand off to the full-region canvas), a block surface renders right where
 * the activity message appears.
 */
export function InlineBlockSurface({ content }: { content: unknown }) {
  const operations = Array.isArray(
    (content as Record<string, unknown> | null | undefined)?.[
      "a2ui_operations"
    ],
  )
    ? ((content as Record<string, unknown>)["a2ui_operations"] as A2UIOp[])
    : [];
  const surfaceId = blockSurfaceIdFrom(content);

  if (!surfaceId) return null;

  return (
    <>
      <InlineBlockMessageProcessor
        operations={operations}
        surfaceId={surfaceId}
      />
      <div
        className="my-2 rounded-lg border border-hairline bg-surface p-3"
        data-testid="inline-block-surface"
      >
        <A2UIRenderer surfaceId={surfaceId} />
      </div>
    </>
  );
}

export default InlineBlockSurface;
