/**
 * Surface-state machine for A2UI v0.9 operations.
 *
 * The A2UI middleware emits a list of operations per surface — typically
 * `createSurface`, `updateComponents`, `updateDataModel` in that order.
 * We apply them in sequence to derive a `SurfaceState`:
 *
 *   { surfaceId, catalogId, components, dataModel }
 *
 * — which is what the renderer walks. Snapshot vs delta:
 *
 *   - For an `ActivitySnapshotEvent` the operations are the FULL set the
 *     middleware has accumulated so far for this surface (re-applying
 *     from the empty state is correct).
 *   - For a delta we *could* incrementally mutate the previous state,
 *     but since renders are cheap and snapshot is the common case
 *     today, we always re-derive from scratch.
 */

/** A single A2UI v0.9 component instance in flat-array form. */
export interface A2UIComponent extends Record<string, unknown> {
  id: string;
  component: string;
}

/**
 * The set of v0.9 operations the middleware can emit. Exactly one of
 * the four "verb" fields is set per operation.
 *
 * Index signature `[key: string]: unknown` lets the type flow through
 * the activity-message renderer's `.passthrough()` Zod schema without
 * fighting variance. Future protocol additions remain forward-compatible.
 */
export interface A2UIOperation {
  version?: string;
  createSurface?: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
    attachDataModel?: boolean;
  };
  updateComponents?: {
    surfaceId: string;
    components: A2UIComponent[];
  };
  updateDataModel?: {
    surfaceId: string;
    path?: string;
    value?: unknown;
    /** Some emitters use `data` instead of `value`. We accept both. */
    data?: unknown;
  };
  deleteSurface?: {
    surfaceId: string;
  };
  [key: string]: unknown;
}

export interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  components: ReadonlyMap<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
}

/**
 * Apply a sequence of A2UI operations and return the resulting surface
 * states (keyed by surfaceId). Surfaces deleted along the way do not
 * appear in the returned map.
 *
 * Pure function: never mutates `operations`, never returns a reference
 * shared with prior state.
 */
export function applyA2UIOperations(
  operations: ReadonlyArray<A2UIOperation>,
): Map<string, SurfaceState> {
  const surfaces = new Map<string, SurfaceState>();

  for (const op of operations) {
    if (op.createSurface) {
      const { surfaceId, catalogId } = op.createSurface;
      // Idempotent: re-creating an existing surface resets it to empty,
      // matching the React-side processor's behavior.
      surfaces.set(surfaceId, {
        surfaceId,
        catalogId,
        components: new Map(),
        dataModel: {},
      });
      continue;
    }

    if (op.updateComponents) {
      const { surfaceId, components } = op.updateComponents;
      const prev = surfaces.get(surfaceId);
      if (!prev) continue; // ignore updates to unknown surfaces
      const m = new Map<string, A2UIComponent>();
      for (const c of components) m.set(c.id, c);
      surfaces.set(surfaceId, { ...prev, components: m });
      continue;
    }

    if (op.updateDataModel) {
      const { surfaceId, path, value, data } = op.updateDataModel;
      const prev = surfaces.get(surfaceId);
      if (!prev) continue;
      const nextValue = value !== undefined ? value : data;
      const nextDataModel =
        path == null
          ? // Whole-replace
            typeof nextValue === "object" && nextValue != null
            ? (nextValue as Record<string, unknown>)
            : {}
          : // Set at path
            setAtPath(prev.dataModel, path, nextValue);
      surfaces.set(surfaceId, { ...prev, dataModel: nextDataModel });
      continue;
    }

    if (op.deleteSurface) {
      surfaces.delete(op.deleteSurface.surfaceId);
      continue;
    }
  }

  return surfaces;
}

/**
 * Set a value at a dotted path inside a *clone* of `obj`, returning the
 * clone. Supports `foo.bar.baz` (no `[index]` notation here — the
 * middleware uses whole-key paths in updateDataModel).
 */
function setAtPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.replace(/^\//, "").split(".").filter(Boolean);
  if (segments.length === 0) {
    return typeof value === "object" && value != null
      ? (value as Record<string, unknown>)
      : {};
  }
  const next: Record<string, unknown> = { ...obj };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i]!;
    const existing = cursor[k];
    const cloned =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[k] = cloned;
    cursor = cloned;
  }
  cursor[segments[segments.length - 1]!] = value;
  return next;
}
