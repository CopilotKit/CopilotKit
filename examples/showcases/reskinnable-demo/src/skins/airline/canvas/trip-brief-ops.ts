/**
 * BEAT 3d — the a2ui operations that OPEN the Trip Brief canvas.
 *
 * EMITTED by the `render_trip_brief` SERVER tool in `agent.ts`, which returns
 * them under `A2UI_OPERATIONS_KEY` in its tool result; the a2ui middleware turns
 * that into the `a2ui-surface` activity the shell's `CanvasProvider` keys off, and
 * `AirlineCanvasSurface` takes the region. It has to be a server tool — a client
 * frontend-tool result never produces that activity — which is why the brief id
 * travels back through `fileTripBrief`'s sentence for the agent to pass along.
 *
 * WHY THIS IS SO MUCH SMALLER THAN THE OTHER FOUR SKINS' OPS BUILDERS.
 * Logistics, banking, people and commerce all render a brief the agent COMPOSES
 * — which KPIs, which charts, which table — so their ops carry a component tree
 * and their catalogs carry the renderers for it. Aeronova's Trip Brief is not a
 * composition: it is ONE durable record the server already settled and stored, of
 * a fixed shape. The only thing left to select is WHICH brief, so that is the
 * only thing that travels. Data never travels in the ops here either, and for a
 * stronger reason than usual: the canvas reads the FILED artifact back off the
 * app (see `use-trip-briefs.ts`), so what the room sees is the thing that
 * survives deleting the conversation, not a re-render of what the model said.
 *
 * A consequence worth stating, because it is the file's one surprise: these ops
 * reference NO catalog component, and `AirlineCanvasSurface` mounts no
 * `A2UIRenderer`. A component tree here would be ceremony around a record that
 * has exactly one layout.
 *
 * Emitting a full component tree instead breaks nothing: the surface reads only
 * the brief id and falls back to the newest brief when it finds none.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"` — it is
 * imported from `agent.ts`, which must never reach the browser bundle.
 */

/** Must match the A2UI middleware's key so `tryParseA2UIOperations` detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export const TRIP_BRIEF_SURFACE_ID = "trip-brief";

/**
 * The id `catalog/index.tsx` passes to `createCatalog`. Restated rather than
 * imported: that module is `"use client"` and carries JSX, so importing it here
 * would drag React into `agent.ts`. `trip-brief-ops.test.ts` pins the pair.
 */
export const TRIP_BRIEF_CATALOG_ID = "airline";

/** Where the brief id sits in the surface's data model. */
export const TRIP_BRIEF_ID_PATH = "/briefId";

export type A2UIOp = Record<string, unknown> & { version?: string };

/**
 * The op pair a `render_trip_brief` tool returns.
 *
 * `briefId` is what `POST /api/airline/v1/briefs` returned as `brief.id`. Pass it
 * — the fallback to "newest" is a safety net for a replayed thread, not a design.
 * A blank or missing id writes NO data-model op at all rather than writing
 * `null`: an explicit null in the model reads as "this surface is about no
 * brief", which is a different claim from "the surface did not say".
 */
export function buildTripBriefOps(
  briefId?: string | null,
  surfaceId: string = TRIP_BRIEF_SURFACE_ID,
): A2UIOp[] {
  const ops: A2UIOp[] = [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: TRIP_BRIEF_CATALOG_ID },
    },
  ];
  const id = typeof briefId === "string" ? briefId.trim() : "";
  if (id) {
    ops.push({
      version: "v0.9",
      updateDataModel: {
        surfaceId,
        path: TRIP_BRIEF_ID_PATH,
        value: id,
      },
    });
  }
  return ops;
}

/** Read the surfaceId out of an A2UI operation list (any op kind). */
export function extractSurfaceId(ops: A2UIOp[]): string | null {
  for (const op of ops) {
    const target = (op.createSurface ??
      op.updateComponents ??
      op.updateDataModel) as { surfaceId?: string } | undefined;
    if (target?.surfaceId) return target.surfaceId;
  }
  return null;
}

/**
 * The brief the surface should show, or `null` when the ops do not name one.
 *
 * Tolerant on purpose. It accepts the `updateDataModel` shape this file writes
 * AND a `briefId` sitting on an `updateComponents` component, so a later slot
 * that builds a richer surface than this one does not have to come back here.
 * Anything it cannot read is `null`, which the surface treats as "show the
 * newest" — never as "show nothing", because a canvas that opened and then
 * rendered blank is the one outcome a presenter cannot explain.
 */
export function readBriefId(ops: A2UIOp[]): string | null {
  for (const op of ops) {
    const model = op.updateDataModel as
      | { path?: string; value?: unknown }
      | undefined;
    if (model && model.path === TRIP_BRIEF_ID_PATH) {
      const value = model.value;
      if (typeof value === "string" && value.trim()) return value.trim();
    }

    const update = op.updateComponents as
      | { components?: Array<Record<string, unknown>> }
      | undefined;
    for (const component of update?.components ?? []) {
      const value = component.briefId;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}
