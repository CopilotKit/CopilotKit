import { z } from "zod";

export type A2UIOperation = Record<string, unknown>;

export const A2UISurfaceActivityType = "a2ui-surface";

export const A2UIActivityContentSchema = z.object({
  operations: z.array(z.record(z.string(), z.unknown())),
});

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
      ?.surfaceId as string | undefined);

  return surfaceId ?? "default";
}
