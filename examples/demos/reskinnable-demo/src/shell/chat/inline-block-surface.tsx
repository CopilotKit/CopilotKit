"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
  useA2UIError,
  useA2UIState,
} from "@copilotkit/a2ui-renderer";
import {
  decideA2uiSurface,
  readableOperations,
} from "@/shell/canvas/canvas-context";
import { useSkin } from "@/shell/skin-provider";

/** Minimal shape of an A2UI operation carrying a surfaceId. */
type A2UIOp = Record<string, unknown>;

/**
 * The block surface this activity should mount inline, or null if it belongs
 * somewhere else (a report surface, which the canvas keeps) or nowhere at all
 * (junk, drift, a stringified envelope this card cannot read).
 *
 * ONE DECISION, TWO READERS. This delegates to `decideA2uiSurface` — the same
 * call the canvas asks for its own claim — rather than scanning the ops a
 * second way. It used to spell the `block:` prefix a third time and take the
 * FIRST op that carried any surfaceId, so a list holding a block surface AND a
 * report surface rendered inline here while ALSO claiming the whole content
 * region; `src/app/[skin]/layout.tsx` dispatches on the assumption the two can
 * never disagree, and now they cannot.
 */
export function blockSurfaceIdFrom(content: unknown): string | null {
  return decideA2uiSurface(content).blockSurfaceId;
}

/**
 * Feeds the surface's operations into the a2ui store owned by the
 * `A2UIProvider` that `InlineBlockSurface` mounts around it. The activity
 * content carries the FULL operation list on each snapshot, so we strip a
 * duplicate createSurface once the surface exists (the MessageProcessor
 * rejects it) and skip re-processing an op list that already APPLIED.
 *
 * "Already applied", not "already seen": this shares its shape with banking's
 * `SurfaceMessageProcessor` (src/skins/banking/canvas-surface.tsx), but latches
 * the op-list hash on the store's VERSION bump rather than at call time — see
 * below. Do not simplify it back into a latch-on-call: that is the bug this
 * version-latch exists to avoid.
 *
 * HOW A REJECTED OP LIST IS DETECTED. `processMessages` never throws and
 * returns nothing: the provider catches the processor's error, `console.warn`s
 * it, records the message in its error state (which `useA2UIError()` exposes
 * on the NEXT render — there is no synchronous read) and returns void. So the
 * only success signal is the store's `version` counter, which it bumps ONLY
 * after the op list applied. This effect therefore records the version it saw
 * when it called, and latches the hash on a LATER run — the one the version
 * bump itself schedules — and only if the version actually advanced.
 *
 * Latching a REJECTED op list would make the failure permanent: the next
 * snapshot carries the same list, which would be skipped as a duplicate
 * forever, leaving the card blank with no path back. Leaving it unlatched
 * means the next snapshot REPLAYS the list, which is safe: `createSurface` is
 * stripped once the surface exists (it is the one op the processor rejects on
 * replay, "Surface … already exists"), and `updateComponents` is replace-style
 * — it overwrites each component id's properties, or recreates the component
 * when its type changed — so replaying it, including over the partial state a
 * mid-list rejection leaves behind, converges on the same surface.
 */
function InlineBlockMessageProcessor({
  operations,
  surfaceId,
}: {
  operations: A2UIOp[];
  surfaceId: string;
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const { version } = useA2UIState();
  const lastHashRef = useRef("");
  const pendingRef = useRef<{ hash: string; version: number } | null>(null);

  useEffect(() => {
    // Settle the previous call first: the version advanced ⇒ that op list
    // applied ⇒ latch it. It did not ⇒ the processor rejected the list, so
    // leave the hash unlatched and let a later snapshot try again. (The
    // failure itself is on screen: `BlockSurfaceBody` renders the provider's
    // error state.)
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      if (version > pending.version) lastHashRef.current = pending.hash;
    }

    if (!operations.length) return;
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;

    pendingRef.current = { hash, version };
    processMessages(ops as Array<Record<string, unknown>>);
  }, [operations, processMessages, getSurface, surfaceId, version]);

  return null;
}

/**
 * The card's inner content — MUST be a child of `A2UIProvider`, since both
 * `useA2UIError()` and the renderer read that store. Renders the surface, and
 * a LOUD error line above it when the provider failed to process the ops: a
 * block that could not be built must say so rather than show an empty box.
 *
 * The line names the block from OUR context (the surface id resolved off the
 * activity content) rather than trusting the provider's message to do it: of
 * the MessageProcessor's rejection messages only "Surface not found for
 * message: <id>" and "Surface <id> already exists" name a surface — "Catalog
 * not found", "Component '<c>' is missing an 'id'", "Cannot create component
 * <id> without a type" and "Message contains multiple update types" do not.
 *
 * The provider is per-card (see `InlineBlockSurface`), so this error slot
 * belongs to this block alone and no sibling's success can clear it.
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
  // Same reader the classification went through, so the ops this card feeds the
  // store are the ops that decided it should mount at all.
  const operations: A2UIOp[] = readableOperations(content) ?? [];
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
