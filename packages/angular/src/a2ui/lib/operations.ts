import type {
  A2uiMessage,
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer/web-components";

export const DEFAULT_A2UI_SURFACE_ID = "default";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getRecordProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function getStringProperty(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The nested payload's `surfaceId` is the v0.9 shape and wins over a top-level one. */
function getSurfaceId(
  payload: Record<string, unknown>,
  operation: Record<string, unknown>,
): string {
  return (
    getStringProperty(payload, "surfaceId") ??
    getStringProperty(operation, "surfaceId") ??
    DEFAULT_A2UI_SURFACE_ID
  );
}

export function getA2UIMessageSurfaceId(message: A2uiMessage): string {
  if ("createSurface" in message) return message.createSurface.surfaceId;
  if ("updateComponents" in message) return message.updateComponents.surfaceId;
  if ("updateDataModel" in message) return message.updateDataModel.surfaceId;
  if ("deleteSurface" in message) return message.deleteSurface.surfaceId;
  return DEFAULT_A2UI_SURFACE_ID;
}

/** Flattens `{ id, component: { Text: { text } } }` to `{ id, component: "Text", text }`. */
function normalizeComponent(component: unknown): unknown {
  if (!isRecord(component) || typeof component.component !== "object") {
    return component;
  }
  const entries = Object.entries(component.component ?? {});
  if (entries.length !== 1) return component;
  const [componentName, props] = entries[0]!;
  return {
    id: component.id,
    component: componentName,
    ...(isRecord(props) ? props : {}),
  };
}

/**
 * Normalizes v0.9 and legacy operation shapes into v0.9 messages. Every
 * `createSurface` is pinned to `catalogId`: the renderer runs one catalog and
 * web_core rejects surfaces naming an unknown one, so a stray id from the
 * model would otherwise blank the surface.
 */
export function normalizeA2UIOperations(
  operations: readonly unknown[],
  catalogId: string,
): A2uiMessage[] {
  return operations.flatMap((operation): A2uiMessage[] => {
    if (!isRecord(operation)) return [];

    const create =
      getRecordProperty(operation, "createSurface") ??
      getRecordProperty(operation, "beginRendering");
    if (create) {
      return [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: getSurfaceId(create, operation),
            catalogId,
            theme: create.theme ?? create.styles ?? {},
            sendDataModel:
              typeof create.sendDataModel === "boolean"
                ? create.sendDataModel
                : undefined,
          },
        },
      ];
    }

    const update =
      getRecordProperty(operation, "updateComponents") ??
      getRecordProperty(operation, "surfaceUpdate");
    if (update) {
      return [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: getSurfaceId(update, operation),
            components: Array.isArray(update.components)
              ? update.components.map(normalizeComponent)
              : [],
          },
        },
      ];
    }

    const data =
      getRecordProperty(operation, "updateDataModel") ??
      getRecordProperty(operation, "dataModelUpdate");
    if (data) {
      return [
        {
          version: "v0.9",
          updateDataModel: {
            surfaceId: getSurfaceId(data, operation),
            path: getStringProperty(data, "path") ?? "/",
            // An explicit `null` is a value; only a missing one falls back.
            value: "value" in data ? data.value : data.contents,
          },
        },
      ];
    }

    const remove = getRecordProperty(operation, "deleteSurface");
    if (remove) {
      return [
        {
          version: "v0.9",
          deleteSurface: { surfaceId: getSurfaceId(remove, operation) },
        },
      ];
    }

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
    const surfaceId = getA2UIMessageSurfaceId(message);
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

/**
 * Shapes a web_core client action like the Lit surface's `a2ui-action` event.
 */
export function toA2UIClientEventMessage(
  action: unknown,
): A2UIClientEventMessage {
  const record = isRecord(action) ? action : {};
  return {
    userAction: {
      name: getStringProperty(record, "name") ?? "unknown",
      surfaceId:
        getStringProperty(record, "surfaceId") ?? DEFAULT_A2UI_SURFACE_ID,
      sourceComponentId: getStringProperty(record, "sourceComponentId"),
      context: isRecord(record.context) ? record.context : {},
      timestamp:
        getStringProperty(record, "timestamp") ?? new Date().toISOString(),
      dataContextPath: getStringProperty(record, "dataContextPath"),
    },
  };
}
