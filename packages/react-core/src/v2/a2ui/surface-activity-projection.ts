import type { Message } from "@ag-ui/core";

type Operation = Record<string, unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function surfaceId(operation: Operation): string | undefined {
  for (const kind of [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
  ]) {
    const payload = operation[kind];
    if (record(payload) && typeof payload.surfaceId === "string")
      return payload.surfaceId;
  }
  return undefined;
}

/**
 * Project activity operations onto their surface's original render slot. A
 * createSurface establishes ownership; an update without one can target only a
 * single preceding owner in this agent's history. Independent creates (even
 * with the same surfaceId) keep separate slots. Ambiguous/orphan updates stay
 * in their own slot rather than guessing ownership. Canonical messages and
 * operation payloads are never changed.
 */
export function projectSurfaceActivities(
  messages: readonly Message[],
): Map<string, Operation[]> {
  const projected = new Map<string, Operation[]>();
  const owners = new Map<string, Set<string>>();
  for (const message of messages) {
    if (message.role !== "activity" || message.activityType !== "a2ui-surface")
      continue;
    const incoming = message.content.a2ui_operations;
    if (!Array.isArray(incoming)) continue;
    const operations = incoming.filter(record);
    projected.set(message.id, []);
    // A full snapshot may place its create after other operations. All its
    // operations for that surface still belong to this activity.
    const creates = new Set(
      operations.filter((op) => record(op.createSurface)).map(surfaceId),
    );
    for (const operation of operations) {
      const id = surfaceId(operation);
      const candidates = id === undefined ? undefined : owners.get(id);
      const owner =
        id !== undefined && !creates.has(id) && candidates?.size === 1
          ? candidates.values().next().value!
          : message.id;
      projected.get(owner)!.push(operation);
      if (id !== undefined && record(operation.createSurface)) {
        const set = owners.get(id) ?? new Set<string>();
        set.add(message.id);
        owners.set(id, set);
      }
      // Delete ends a uniquely owned surface lifetime. A later create is a
      // new owner; ambiguous deletes cannot safely choose between instances.
      if (
        id !== undefined &&
        record(operation.deleteSurface) &&
        candidates?.size === 1
      ) {
        owners.delete(id);
      }
    }
  }
  return projected;
}
