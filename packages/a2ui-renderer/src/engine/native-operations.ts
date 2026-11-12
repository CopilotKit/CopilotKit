import { isCatalogVersionCompatible } from "@a2ui/web_core/adapters";
import { CreateSurfaceMessageSchema } from "@a2ui/web_core/v1_0";
import type {
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";

/**
 * Native A2UI 1.0 support for the operation applier. A separate module, so
 * a renderer that only speaks v0.9 (Vue, Angular) does not load the 1.0
 * schemas: the React provider passes {@link a2uiNativeOperations} to
 * `A2UIOperationApplier`, which then hands native messages to web_core as
 * they arrived instead of dropping them.
 */
export interface A2UINativeOperations {
  /**
   * Checks a whole batch against the processor's surfaces before any of it is
   * applied, so a rejected batch leaves the existing cards as they were.
   * Throws when a message would change a surface's protocol version, or when
   * a repeated native `createSurface` cannot be replayed.
   */
  validate(
    processor: MessageProcessor<ComponentApi>,
    messages: readonly Record<string, unknown>[],
  ): void;
  /**
   * The updates that replay a repeated native `createSurface` for a surface
   * that already exists. Content snapshots repeat creation, and a native
   * create can carry the current components and data model inline.
   *
   * @param message - A `createSurface` that passed {@link validate}.
   * @param previousOperations - The previous snapshot as it arrived, to
   *   compare the inline data model with, so an unchanged one does not
   *   overwrite local edits.
   */
  replayCreate(
    message: Record<string, unknown>,
    previousOperations: readonly unknown[],
  ): Record<string, unknown>[];
}

const SURFACE_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A protocol version without its optional `v` prefix: `"0.9"`, `"1.0"`. */
function bareVersion(version: unknown) {
  return typeof version === "string" ? version.replace(/^v/, "") : undefined;
}

function formatIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
) {
  return issues
    .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
    .join("; ");
}

interface KnownSurface {
  version: string | undefined;
  catalogId: string | undefined;
}

function knownSurfaces(processor: MessageProcessor<ComponentApi>) {
  return new Map<string, KnownSurface>(
    Array.from(
      processor.model.surfacesMap,
      ([id, surface]: [string, SurfaceModel<ComponentApi>]) => [
        id,
        {
          version: bareVersion(surface.protocolVersion),
          catalogId: surface.catalog?.id,
        },
      ],
    ),
  );
}

export const a2uiNativeOperations: A2UINativeOperations = {
  validate(processor, messages) {
    const surfaces = knownSurfaces(processor);
    for (const message of messages) {
      const key = SURFACE_KEYS.find((candidate) =>
        isRecord(message[candidate]),
      );
      if (!key) continue;
      const body = message[key] as Record<string, unknown>;
      const surfaceId = body.surfaceId;
      if (typeof surfaceId !== "string") continue;
      const version = bareVersion(message.version);
      const existing = surfaces.get(surfaceId);
      if (existing && !isCatalogVersionCompatible(existing.version, version)) {
        throw new Error(
          `A2UI surface "${surfaceId}" uses protocol version ${String(existing.version)}; received ${String(message.version)}. Create a new surface to change versions.`,
        );
      }
      if (key === "deleteSurface") {
        surfaces.delete(surfaceId);
        continue;
      }
      if (key !== "createSurface") continue;
      if (existing && version !== "0.9") {
        // A repeated native create is replayed as updates, so check here
        // what web_core would check when creating the surface.
        if (message.version !== "1.0") {
          throw new Error(
            `A2UI surface "${surfaceId}" uses protocol version 1.0; received a repeated createSurface with version ${String(message.version)}.`,
          );
        }
        const parsed = CreateSurfaceMessageSchema.safeParse(message);
        if (!parsed.success) {
          throw new Error(
            `Invalid A2UI createSurface for surface "${surfaceId}": ${formatIssues(parsed.error.issues)}`,
          );
        }
        const catalogId = parsed.data.createSurface.catalogId;
        if (catalogId !== undefined && catalogId !== existing.catalogId) {
          throw new Error(
            `A2UI surface "${surfaceId}" uses catalog ${String(existing.catalogId)}; received ${catalogId}. Create a new surface to change catalogs.`,
          );
        }
      }
      surfaces.set(surfaceId, {
        version,
        catalogId:
          existing?.catalogId ??
          (typeof body.catalogId === "string" ? body.catalogId : undefined),
      });
    }
  },

  replayCreate(message, previousOperations) {
    const create = message.createSurface as Record<string, unknown>;
    const surfaceId = create.surfaceId;
    const previousCreate = previousOperations.find(
      (previous): previous is Record<string, unknown> =>
        isRecord(previous) &&
        previous.version === "1.0" &&
        isRecord(previous.createSurface) &&
        previous.createSurface.surfaceId === surfaceId,
    )?.createSurface as Record<string, unknown> | undefined;

    const updates: Record<string, unknown>[] = [];
    // The native create applies its data model before its components. A
    // repeated, unchanged data model must not replace client-side edits.
    if (
      Object.prototype.hasOwnProperty.call(create, "dataModel") &&
      (!previousCreate ||
        !Object.prototype.hasOwnProperty.call(previousCreate, "dataModel") ||
        JSON.stringify(create.dataModel) !==
          JSON.stringify(previousCreate.dataModel))
    ) {
      updates.push({
        version: "1.0",
        updateDataModel: { surfaceId, value: create.dataModel },
      });
    }
    if (Object.prototype.hasOwnProperty.call(create, "components")) {
      updates.push({
        version: "1.0",
        updateComponents: { surfaceId, components: create.components },
      });
    }
    return updates;
  },
};
