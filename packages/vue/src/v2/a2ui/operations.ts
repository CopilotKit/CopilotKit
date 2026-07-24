import { z } from "zod";

export type A2UIOperation = Record<string, unknown>;

export const A2UISurfaceActivityType = "a2ui-surface";

export const A2UIActivityContentSchema = z.object({
  operations: z.array(z.record(z.string(), z.unknown())),
});

/**
 * Resolve the surface ID for an A2UI operation.
 *
 * Public contract: always returns a string (defaults to `"default"`) and
 * recognizes legacy Vue operation shapes in addition to v0.9 keys.
 */
export function getOperationSurfaceId(operation: A2UIOperation): string {
  const surfaceId =
    (operation.surfaceId as string | undefined) ??
    ((operation.beginRendering as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.surfaceUpdate as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.dataModelUpdate as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.deleteSurface as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.createSurface as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.updateComponents as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.updateDataModel as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined);

  return surfaceId ?? "default";
}

/** React-style helper for internal grouping when a missing id should stay ungrouped. */
export function getOperationSurfaceIdOrNull(
  operation: A2UIOperation,
): string | null {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  if (typeof operation.surfaceId === "string") {
    return operation.surfaceId;
  }

  return (
    (operation?.createSurface as { surfaceId?: string } | undefined)
      ?.surfaceId ??
    (operation?.updateComponents as { surfaceId?: string } | undefined)
      ?.surfaceId ??
    (operation?.updateDataModel as { surfaceId?: string } | undefined)
      ?.surfaceId ??
    (operation?.deleteSurface as { surfaceId?: string } | undefined)
      ?.surfaceId ??
    null
  );
}
