import { z } from "zod";

export type A2UIOperation = Record<string, unknown>;

export const A2UISurfaceActivityType = "a2ui-surface";

export const A2UIActivityContentSchema = z.object({
  operations: z.array(z.record(z.string(), z.unknown())),
});

export function getOperationSurfaceId(operation: A2UIOperation): string | null {
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
