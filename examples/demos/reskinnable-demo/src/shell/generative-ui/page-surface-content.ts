import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";

/** An A2UI operation as the app reads it: v0.9 or 1.0, not yet checked. */
export type SurfaceOperation = Record<string, unknown>;

/** The op containers that carry a `surfaceId`. */
const SURFACE_OP_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

/**
 * A v0.9 dynamic value as A2UI 1.0: `{ path }` becomes `{ "@path" }`, at any
 * depth. Literals stay. The app's op builders emit literals only, so this is
 * defensive: the runtime converts the agent's v0.9 surfaces itself, and only
 * ops the app builds and renders without a run (exec's pinned blocks) pass
 * through here as v0.9.
 */
function upgradeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && typeof record.path === "string") {
    return { "@path": record.path };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, upgradeValue(item)]),
  );
}

/**
 * The content of a page-owned surface: `operations` (v0.9 or 1.0) as A2UI 1.0
 * operations for the surface `target`. Every op is re-addressed to `target`,
 * so the copy never collides with the surface the agent's run created (the
 * chat owns that one, under the original id). Returns null when no op names
 * a surface.
 */
export function pageSurfaceContent(
  operations: readonly SurfaceOperation[],
  target: string,
): GenerativeUISurfaceContent | null {
  let catalogId = "";
  const upgraded: A2UIOperation[] = [];
  for (const op of operations) {
    if (!op || typeof op !== "object") continue;
    const key = SURFACE_OP_KEYS.find(
      (name) => op[name] && typeof op[name] === "object",
    );
    if (!key) continue;
    const payload = op[key] as Record<string, unknown>;
    const isV09 = op.version !== "1.0";
    if (key === "createSurface" && typeof payload.catalogId === "string") {
      catalogId ||= payload.catalogId;
    }
    const next: Record<string, unknown> = { ...payload, surfaceId: target };
    if (isV09 && key === "updateComponents") {
      next.components = upgradeValue(payload.components);
    }
    upgraded.push({ version: "1.0", [key]: next } as A2UIOperation);
  }
  if (!upgraded.length) return null;
  return {
    surfaceId: target,
    target,
    catalogId,
    operations: upgraded,
    status: "ready",
    rejected: [],
  };
}
