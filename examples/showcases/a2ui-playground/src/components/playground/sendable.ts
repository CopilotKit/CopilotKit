/**
 * A surface as it would be sent: one A2UI v1.0 `createSurface` with its
 * components and data model after every operation so far. The `Blueprint`
 * frames the playground streams while a component is still being written are
 * left out: Blueprint is not in the catalog, it only lets the chat paint early.
 * The JSON tab, its Copy and Export, the editor and the Express view all read
 * this, never the raw streamed operations.
 */
import { A2UI_VERSION } from "@copilotkit/shared";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { latestComponents, latestData, surfaceIdOf, type A2UIOp } from "@/lib/run-store";

export type Sendable = { ops: A2UIOp[]; surfaceId: string; components: number; pending: number };

export function sendable(ops: A2UIOp[], surfaceId = surfaceIdOf(ops)): Sendable {
  const create = ops.find((op) => op.createSurface)?.createSurface as { catalogId?: unknown } | undefined;
  const all = latestComponents(ops);
  const components = all.filter((c) => c.component !== "Blueprint");
  const data = latestData(ops);
  const op: A2UIOp = {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      catalogId: typeof create?.catalogId === "string" ? create.catalogId : CATALOG_ID,
      components,
      ...(Object.keys(data).length ? { dataModel: data } : {}),
    },
  };
  return { ops: [op], surfaceId, components: components.length, pending: all.length - components.length };
}
