"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import { TripBriefCard } from "./canvas/trip-brief-card";
import {
  A2UI_OPERATIONS_KEY,
  extractSurfaceId,
  readBriefId,
} from "./canvas/trip-brief-ops";
import type { A2UIOp } from "./canvas/trip-brief-ops";
import { selectBrief, useTripBriefs } from "./canvas/use-trip-briefs";

/**
 * Aeronova's Trip Brief canvas — `skin.CanvasSurface`.
 *
 * MOUNTED. `skin.tsx` sets `CanvasSurface: AirlineCanvasSurface`, and the
 * `render_trip_brief` server tool in `agent.ts` emits `buildTripBriefOps(briefId)`
 * from `./canvas/trip-brief-ops` under `A2UI_OPERATIONS_KEY` — without that
 * emission nothing ever opens this region, because the a2ui middleware only
 * produces an `a2ui-surface` activity from an in-stream TOOL_CALL_RESULT. The
 * shell owns the region, the "← Back" affordance, OGUI and the surface-kind
 * detection (`src/shell/canvas/`); this component owns only what goes inside for
 * a "report" surface.
 *
 * WHY THERE IS NO `A2UIProvider` / `A2UIRenderer` HERE, unlike the other four
 * skins. Their briefs are compositions the agent selects, so the ops carry a
 * component tree and the catalog carries the renderers. Aeronova's Trip Brief is
 * a single durable record of fixed shape that the SERVER already settled — the
 * only selection left is which brief, and that is all the ops carry. The
 * reasoning, and what happens if a richer tree is emitted anyway, is in
 * `canvas/trip-brief-ops.ts`.
 *
 * The upshot for the beat is the strong version of it: what the room sees is the
 * artifact read back off the app, not a replay of what the model said. Delete
 * the conversation and this canvas draws exactly the same thing.
 */

/** Minimal shape of an activity message in the agent's message list. */
type MaybeActivityMessage = {
  id?: string;
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/**
 * The latest a2ui surface in the agent's message stream — the same read banking,
 * logistics, people and commerce each do, because the a2ui middleware turns the
 * render tool's result into an `a2ui-surface` activity carrying
 * `a2ui_operations`.
 *
 * `activityId` is returned as well as the brief id: it is what re-triggers the
 * fetch, so a brief filed during THIS run is read after it was written. Keying
 * on the brief id alone would not do it — a second brief filed while the canvas
 * is already open on the first is a change of id, but a re-render of the SAME
 * brief (a retried tool call) is not.
 */
function useTripBriefSurface(): {
  briefId: string | null;
  activityId: string | null;
} {
  const { agent } = useAgent();
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message?.role !== "activity" ||
        message?.activityType !== "a2ui-surface"
      ) {
        continue;
      }
      const operations =
        (message.content?.[A2UI_OPERATIONS_KEY] as A2UIOp[] | undefined) ?? [];
      return {
        briefId: readBriefId(operations),
        activityId:
          message.id ?? extractSurfaceId(operations) ?? "a2ui-surface",
      };
    }
  }
  return { briefId: null, activityId: null };
}

/**
 * Every state says something.
 *
 * A canvas that opened and then rendered an empty region is indistinguishable
 * from a write that silently failed, and the presenter has nothing to say about
 * it. So loading, failure, an empty ledger and a named-but-missing brief each
 * print their own sentence.
 */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-hairline bg-surface p-6 text-sm text-ink-muted shadow-soft">
      {children}
    </div>
  );
}

export function AirlineCanvasSurface() {
  const { briefId, activityId } = useTripBriefSurface();
  const { briefs, status, error } = useTripBriefs(activityId);
  const brief = selectBrief(briefs, briefId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8" data-testid="a2ui-surface">
        {status === "loading" ? (
          <Notice>Reading the filed trip briefs…</Notice>
        ) : status === "error" ? (
          <Notice>
            Could not read the filed trip briefs
            {error ? ` (${error})` : ""}. The brief may still have been filed —
            check <code>GET /api/airline/v1/briefs</code>.
          </Notice>
        ) : brief ? (
          <TripBriefCard brief={brief} />
        ) : briefId ? (
          // Named a brief the app does not have. `selectBrief` refuses to fall
          // through to the newest here on purpose: showing a DIFFERENT brief
          // under this run's headline is worse than showing none.
          <Notice>
            This run filed brief <code>{briefId}</code>, but it is not on the
            trip record. Nothing is being shown rather than a different brief.
          </Notice>
        ) : (
          <Notice>No trip brief has been filed yet.</Notice>
        )}
      </div>
    </div>
  );
}

export default AirlineCanvasSurface;
