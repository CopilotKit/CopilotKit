import { A2UI_DEFAULT_SURFACE_ID, A2UI_OPERATIONS_KEY } from "./constants";

/** One A2UI operation as it arrives on the wire, before validation. */
export type A2UIOperation = Record<string, unknown>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the A2UI operations from activity content or a tool result payload.
 * The `a2ui_operations` key wins; a bare `operations` key is accepted too.
 * Entries that are not objects are dropped.
 *
 * @param content - Activity content or a parsed tool result, of any shape.
 * @returns The operations, or an empty list when there are none.
 */
export function getA2UIOperations(content: unknown) {
  if (!isRecord(content)) return [];
  const operations = content[A2UI_OPERATIONS_KEY] ?? content.operations;
  if (!Array.isArray(operations)) return [];
  return operations.filter(isRecord);
}

/**
 * The operation keys that nest a `surfaceId`, v0.9 first, then the v0.8 keys
 * older agents still send.
 */
const NESTED_SURFACE_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
  "beginRendering",
  "surfaceUpdate",
  "dataModelUpdate",
] as const;

/**
 * Resolves the surface an operation addresses.
 *
 * The nested `surfaceId` wins, because that is the id `MessageProcessor`
 * creates the surface under. Grouping by a top-level `surfaceId` instead files
 * the operations against a surface that never exists, which paints nothing
 * (OSS-1048). A top-level `surfaceId` is honoured only when no nested id is
 * present.
 *
 * @param operation - One A2UI operation, of any shape.
 * @returns The surface id, or null when the operation names none.
 */
export function getA2UIOperationSurfaceId(operation: unknown) {
  if (!isRecord(operation)) return null;
  for (const key of NESTED_SURFACE_KEYS) {
    const inner = operation[key];
    if (isRecord(inner) && typeof inner.surfaceId === "string") {
      return inner.surfaceId;
    }
  }
  return typeof operation.surfaceId === "string" ? operation.surfaceId : null;
}

/**
 * Groups operations by the surface they address, in first-seen order. An
 * operation that names no surface goes under `"default"`.
 *
 * @param operations - Operations in arrival order.
 */
export function groupA2UIOperationsBySurface(
  operations: readonly A2UIOperation[],
) {
  const groups = new Map<string, A2UIOperation[]>();
  for (const operation of operations) {
    const surfaceId =
      getA2UIOperationSurfaceId(operation) ?? A2UI_DEFAULT_SURFACE_ID;
    const group = groups.get(surfaceId);
    if (group) group.push(operation);
    else groups.set(surfaceId, [operation]);
  }
  return groups;
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== "";
}

/**
 * The component definitions an operation carries: those of an
 * `updateComponents`, or those a native (A2UI 1.0) `createSurface` carries
 * inline.
 *
 * @param operation - One A2UI operation.
 */
export function getA2UIOperationComponents(operation: A2UIOperation) {
  const update = operation.updateComponents;
  const create = operation.createSurface;
  const components = isRecord(update)
    ? update.components
    : operation.version === "1.0" && isRecord(create)
      ? create.components
      : undefined;
  return Array.isArray(components) ? (components as unknown[]) : [];
}

/**
 * Whether operations are enough to paint a visible card yet. A data-bound
 * surface addresses its values by `path` (`@path` in A2UI 1.0) and draws
 * nothing until a data model update, or a native create's inline data model,
 * carries a non-empty value; a static surface paints from its components
 * alone. Times the loader → surface hand-off to real content rather than a
 * fixed delay (OSS-162).
 *
 * @param operations - The operations of one surface or of a whole activity.
 */
export function surfaceHasRenderableContent(
  operations: readonly A2UIOperation[],
) {
  const components = operations.flatMap(getA2UIOperationComponents);
  if (components.length === 0) return false;
  const serialized = JSON.stringify(components);
  const needsData =
    serialized.includes('"path"') || serialized.includes('"@path"');
  if (!needsData) return true;
  return operations.some((operation) => {
    const update = isRecord(operation.updateDataModel)
      ? operation.updateDataModel
      : undefined;
    const create = operation.createSurface;
    const value =
      update?.value ??
      (operation.version === "1.0" && isRecord(create)
        ? create.dataModel
        : undefined);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      // A scalar leaf update paints only the binding that reads it, not a
      // structural {componentId, path} template or an unrelated binding.
      const path = typeof update?.path === "string" ? update.path : "/";
      const key = operation.version === "1.0" ? "@path" : "path";
      return (
        value !== "" && serialized.includes(JSON.stringify({ [key]: path }))
      );
    }
    if (typeof value !== "object" || value === null) return false;
    return Object.values(value).some(hasValue);
  });
}
