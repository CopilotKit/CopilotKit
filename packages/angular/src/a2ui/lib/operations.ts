import {
  A2uiMessage,
  A2uiMessageSchema,
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";

function surfaceIdOf(message: A2uiMessage): string {
  if ("createSurface" in message) return message.createSurface.surfaceId;
  if ("updateComponents" in message) return message.updateComponents.surfaceId;
  if ("updateDataModel" in message) return message.updateDataModel.surfaceId;
  return message.deleteSurface.surfaceId;
}

/**
 * Keeps the operations that are valid A2UI v0.9 messages; an operation without
 * a `version` is read as v0.9. Every `createSurface` is pinned to `catalogId`:
 * the renderer runs one catalog and web_core rejects surfaces naming an unknown
 * one, so a stray id from the model would otherwise blank the surface. Anything
 * else, such as a v0.8 message, is dropped with a warning.
 */
export function normalizeA2UIOperations(
  operations: readonly unknown[],
  catalogId: string,
): A2uiMessage[] {
  return operations.flatMap((operation) => {
    const message: Record<string, unknown> = {
      version: "v0.9",
      ...(typeof operation === "object" ? operation : {}),
    };
    if (
      message["createSurface"] &&
      typeof message["createSurface"] === "object"
    ) {
      message["createSurface"] = { ...message["createSurface"], catalogId };
    }
    const parsed = A2uiMessageSchema.safeParse(message);
    if (parsed.success) return [parsed.data];
    console.warn(
      "[A2UI Angular] Dropped an operation that is not an A2UI v0.9 message:",
      operation,
      parsed.error.issues,
    );
    return [];
  });
}

/**
 * Applies operations in order and returns the surfaces they address that
 * still exist. A `createSurface` for an existing surface is skipped, and a
 * surface addressed before it is created gets one with `catalogId` and `theme`.
 */
export function applyA2UIOperations<T extends ComponentApi>(
  processor: MessageProcessor<T>,
  operations: readonly unknown[],
  catalogId: string,
  theme?: Record<string, unknown>,
): SurfaceModel<T>[] {
  const surfaceIds = new Set<string>();
  const exists = (surfaceId: string) =>
    processor.model.getSurface(surfaceId) !== undefined;

  for (const message of normalizeA2UIOperations(operations, catalogId)) {
    const surfaceId = surfaceIdOf(message);
    surfaceIds.add(surfaceId);
    if ("createSurface" in message) {
      if (!exists(surfaceId)) processor.processMessages([message]);
      continue;
    }
    if ("deleteSurface" in message) {
      if (exists(surfaceId)) processor.processMessages([message]);
      continue;
    }
    if (!exists(surfaceId)) {
      processor.processMessages([
        {
          version: "v0.9",
          createSurface: { surfaceId, catalogId, theme: theme ?? {} },
        },
      ]);
    }
    processor.processMessages([message]);
  }

  return [...surfaceIds]
    .map((surfaceId) => processor.model.getSurface(surfaceId))
    .filter((surface): surface is SurfaceModel<T> => surface !== undefined);
}
