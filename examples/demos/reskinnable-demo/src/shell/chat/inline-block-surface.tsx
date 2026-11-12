"use client";

import {
  decideA2uiSurface,
  readableOperations,
} from "@/shell/canvas/canvas-context";
import { PageSurface } from "@/shell/generative-ui/page-surface";

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
 * The shell's inline chat renderer for exec block surfaces — a small,
 * self-contained card that renders a single block dashboard tile inline in
 * the transcript. Unlike the banking/report and OGUI activity types (which
 * hand off to the full-region canvas), a block surface renders right where
 * the activity message appears.
 *
 * WHY IT RENDERS A COPY. The shell's `renderActivityMessages` array SHADOWS
 * CopilotKit's built-in `generative-ui-surface` renderer (app renderers are
 * resolved first), so the chat would otherwise draw nothing here. The card
 * renders the activity's ops through `<PageSurface>`, which re-addresses them
 * to a target of its own (`inline:<surfaceId>`) in the provider's surface
 * manager — the same manager, and so the same skin UI (`skin.catalog`, handed
 * to `CopilotKitProvider` as `generativeUI={{ ui }}`), that renders the canvas.
 * Each card has its own target, so a block's surface can never collide with,
 * or be clobbered by, the canvas's or another card's.
 *
 * A LOUD error line sits above the block when the browser rejected some of its
 * ops: a block that could not be built must say so rather than show an empty
 * box. The line names the block from OUR context (the surface id resolved off
 * the activity content).
 */
export function InlineBlockSurface({ content }: { content: unknown }) {
  // Same reader the classification went through, so the ops this card renders
  // are the ops that decided it should mount at all.
  const operations = readableOperations(content) ?? [];
  const surfaceId = blockSurfaceIdFrom(content);

  if (!surfaceId) return null;

  return (
    <div
      className="my-2 rounded-lg border border-hairline bg-surface p-3"
      data-testid="inline-block-surface"
    >
      <PageSurface
        target={`inline:${surfaceId}`}
        operations={operations}
        renderRejected={(reasons) => (
          <p role="alert" className="mb-2 text-xs text-negative">
            {surfaceId}: this block could not be rendered — {reasons[0]}
          </p>
        )}
      />
    </div>
  );
}

export default InlineBlockSurface;
