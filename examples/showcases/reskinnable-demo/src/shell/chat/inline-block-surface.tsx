"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
  useA2UIError,
} from "@copilotkit/a2ui-renderer";
import { useSkin } from "@/shell/skin-provider";

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
 * Feeds the surface's operations into the a2ui store owned by the
 * `A2UIProvider` that `InlineBlockSurface` mounts around it. The activity
 * content carries the FULL operation list on each snapshot, so we strip a
 * duplicate createSurface once the surface exists (the MessageProcessor
 * rejects it) and skip re-processing identical op lists. Copied from banking's
 * `SurfaceMessageProcessor` (src/skins/banking/canvas-surface.tsx).
 *
 * The hash latch is written only AFTER a successful `processMessages`: latching
 * first would make ANY failure permanent, because the next snapshot carries the
 * same op list and would be skipped as a duplicate forever. The card would then
 * stay blank with no path back.
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

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;
    try {
      processMessages(ops as Array<Record<string, unknown>>);
    } catch (err) {
      // Defense in depth: the provider's `processMessages` catches internally
      // and reports through `useA2UIError()` (rendered loudly by
      // `BlockSurfaceBody` below), so this branch fires only if a future
      // version lets one escape. Either way the latch stays unset, so the next
      // snapshot retries instead of inheriting a dead surface.
      console.warn("[inline-block-surface] processMessages threw:", err);
      return;
    }
    lastHashRef.current = hash;
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

/**
 * The card's inner content — MUST be a child of `A2UIProvider`, since both
 * `useA2UIError()` and the renderer read that store. Renders the surface, and
 * a LOUD error line above it when the provider failed to process the ops: a
 * block that could not be built must say so rather than show an empty box.
 */
function BlockSurfaceBody({ surfaceId }: { surfaceId: string }) {
  const error = useA2UIError();
  return (
    <div
      className="my-2 rounded-lg border border-hairline bg-surface p-3"
      data-testid="inline-block-surface"
    >
      {error !== null && (
        <p role="alert" className="mb-2 text-xs text-negative">
          {surfaceId}: this block could not be rendered — {error}
        </p>
      )}
      <A2UIRenderer surfaceId={surfaceId} />
    </div>
  );
}

/**
 * The shell's inline chat renderer for exec block surfaces — a small,
 * self-contained card that renders a single block dashboard tile inline in
 * the transcript. Unlike the banking/report and OGUI activity types (which
 * hand off to the full-region canvas), a block surface renders right where
 * the activity message appears.
 *
 * MOUNTS ITS OWN `<A2UIProvider>`, and must: there is no ambient a2ui store on
 * this path. `CopilotKitProvider`'s `a2ui.catalog` prop does NOT mount a
 * provider — it only feeds agent-context strings (`A2UICatalogContext`, which
 * despite the name registers context entries and renders null) and configures
 * CopilotKit's BUILT-IN `a2ui-surface` activity renderer, whose internal
 * `ReactSurfaceHost` is the only thing that mounts an `A2UIProvider`. The
 * shell's `renderActivityMessages` array SHADOWS that built-in renderer
 * (user-supplied renderers are resolved first), so nothing upstream of this
 * card ever mounts one and `useA2UIActions()` would throw — taking the whole
 * page down with it, there being no error boundary in between.
 *
 * The catalog comes from `useSkin().catalog` — the SAME object the layout hands
 * `CopilotKitProvider` as `a2ui={{ catalog: skin.catalog }}`, reached through
 * the shell's own skin contract rather than by importing from `src/skins/`.
 *
 * One provider per rendered activity is deliberate (the same call the exec
 * dashboard grid makes for its own page-owned provider): a block's surface
 * state can then never collide with, or be clobbered by, the canvas's.
 */
export function InlineBlockSurface({ content }: { content: unknown }) {
  const catalog = useSkin().catalog;
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
    <A2UIProvider catalog={catalog}>
      <InlineBlockMessageProcessor
        operations={operations}
        surfaceId={surfaceId}
      />
      <BlockSurfaceBody surfaceId={surfaceId} />
    </A2UIProvider>
  );
}

export default InlineBlockSurface;
